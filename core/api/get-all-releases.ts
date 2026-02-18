import type { GitHubClientContext } from '../../types/github-client-context'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Fetch releases for a repository.
 *
 * Resolves SHA only for the first returned release via target_commitish when it
 * looks like a SHA; further enrichment happens at higher levels when needed.
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
    let releases = releasesResp.data as {
      target_commitish: string | null
      published_at: string
      name: string | null
      body: string | null
      prerelease: boolean
      html_url: string
      tag_name: string
    }[]

    let releaseInfos: ReleaseInfo[] = []
    let i = 0
    for (let release of releases) {
      let sha: string | null = null
      if (i === 0 && release.tag_name) {
        sha =
          isLikelySha(release.target_commitish) ?
            release.target_commitish
          : null
      }

      releaseInfos.push({
        publishedAt: new Date(release.published_at),
        name: release.name ?? release.tag_name,
        description: release.body ?? null,
        isPrerelease: release.prerelease,
        version: release.tag_name,
        url: release.html_url,
        sha,
      })
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

function isLikelySha(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  let normalized = value.replace(/^v/u, '')
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}
