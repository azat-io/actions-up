import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubReleasePayload } from './normalize-release'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { isCommitSha } from '../versions/is-commit-sha'
import { normalizeRelease } from './normalize-release'
import { makeRequest } from './make-request'

/**
 * Fetch the latest release for a repository.
 *
 * If the latest release does not exist (404), returns null. The commit SHA may
 * be taken from target_commitish when it looks like a SHA; callers can resolve
 * the tag via git refs later when pinning.
 *
 * @param context - Client context.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @returns Last release info or null when no latest release exists.
 */
export async function getLatestRelease(
  context: GitHubClientContext,
  owner: string,
  repo: string,
): Promise<ReleaseInfo | null> {
  try {
    let releaseResp = await makeRequest(
      context,
      `/repos/${owner}/${repo}/releases/latest`,
    )
    let release = releaseResp.data as GitHubReleasePayload

    let sha: string | null =
      isCommitSha(release.target_commitish) ? release.target_commitish : null

    return normalizeRelease(release, sha)
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
