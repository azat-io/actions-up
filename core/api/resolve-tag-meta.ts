import type { GitHubClient } from '../../types/github-client'

/**
 * Read the publication date and commit SHA of a tag, best effort.
 *
 * Any failure other than a rate limit falls back to nulls, so callers can use
 * their own SHA resolution chain.
 *
 * @param client - GitHub client instance.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name to inspect.
 * @returns Tag date and SHA, both null when the lookup fails.
 * @throws GitHubRateLimitError - When the request was rate limited, so the run
 *   reports the rate limit instead of passing an undated tag off as old
 *   enough.
 */
export async function resolveTagMeta(
  client: GitHubClient,
  parameters: { owner: string; repo: string; tag: string },
): Promise<{ sha: string | null; date: Date | null }> {
  try {
    let { owner, repo, tag } = parameters
    let info = await client.getTagInfo(owner, repo, tag)
    return { date: info?.date ?? null, sha: info?.sha ?? null }
  } catch (error) {
    if (error instanceof Error && error.name === 'GitHubRateLimitError') {
      throw error
    }
    return { date: null, sha: null }
  }
}
