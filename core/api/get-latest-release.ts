import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubReleasePayload } from './normalize-release'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { normalizeRelease } from './normalize-release'
import { makeRequest } from './make-request'

/**
 * Fetch the latest release for a repository.
 *
 * If the latest release does not exist (404), returns null. The release names
 * no commit: the one an update pins is read from the tag reference.
 *
 * @param context - Client context.
 * @param owner - Repository owner.
 * @param repository - Repository name.
 * @returns Last release info or null when no latest release exists.
 */
export async function getLatestRelease(
  context: GitHubClientContext,
  owner: string,
  repository: string,
): Promise<ReleaseInfo | null> {
  try {
    let releaseResp = await makeRequest(
      context,
      `/repos/${owner}/${repository}/releases/latest`,
    )
    return normalizeRelease(releaseResp.data as GitHubReleasePayload)
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 404
    ) {
      return null
    }
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}
