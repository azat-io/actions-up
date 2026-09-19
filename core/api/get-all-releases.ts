import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubReleasePayload } from './normalize-release'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { isCommitSha } from '../versions/is-commit-sha'
import { normalizeRelease } from './normalize-release'
import { makeRequest } from './make-request'

/**
 * Fetch releases for a repository.
 *
 * Resolves SHA only for the first returned release via target_commitish when it
 * looks like a SHA; callers can resolve the tag via git refs later when
 * pinning.
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
    let releases = releasesResp.data as GitHubReleasePayload[]

    let releaseInfos: ReleaseInfo[] = []
    let i = 0
    for (let release of releases) {
      let sha: string | null = null
      if (i === 0 && release.tag_name) {
        sha =
          isCommitSha(release.target_commitish) ?
            release.target_commitish
          : null
      }

      releaseInfos.push(normalizeRelease(release, sha))
      i++
    }

    return releaseInfos
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}
