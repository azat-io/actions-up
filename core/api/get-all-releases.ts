import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubReleasePayload } from './normalize-release'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { normalizeRelease } from './normalize-release'
import { makeRequest } from './make-request'

/**
 * Fetch the published releases of a repository.
 *
 * A token with push access also sees draft releases. A draft has no publication
 * date, and the cool-down has no date to measure it by, nor is it a release
 * anyone can depend on yet, so drafts are left out.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.limit - Maximum number of releases to fetch (default 10).
 * @returns Array of normalized release information.
 */
export async function getAllReleases(
  context: GitHubClientContext,
  parameters: { limit?: number; owner: string; repo: string },
): Promise<ReleaseInfo[]> {
  try {
    let { limit = 10, owner, repo } = parameters
    let releasesResp = await makeRequest(
      context,
      `/repos/${owner}/${repo}/releases?per_page=${limit}`,
    )
    let releases = releasesResp.data as (Omit<
      GitHubReleasePayload,
      'published_at'
    > & { published_at: string | null })[]

    return releases
      .filter(
        (release): release is GitHubReleasePayload =>
          release.published_at !== null,
      )
      .map(release => normalizeRelease(release))
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}
