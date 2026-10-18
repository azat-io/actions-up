import type { GitHubClientContext } from '../../types/github-client-context'
import type { TagInfo } from '../../types/tag-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Fetch tags list.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.limit - Max items.
 * @returns TagInfo array.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the request failed for any other reason.
 */
export async function getAllTags(
  context: GitHubClientContext,
  parameters: { limit?: number; owner: string; repo: string },
): Promise<TagInfo[]> {
  try {
    let { limit = 30, owner, repo } = parameters
    let resp = await makeRequest(
      context,
      `/repos/${owner}/${repo}/tags?per_page=${limit}`,
    )
    let tags = resp.data as {
      commit: { sha: string; url: string }
      zipball_url: string
      tarball_url: string
      node_id: string
      name: string
    }[]

    return tags.map(tag => ({
      sha: tag.commit.sha,
      tag: tag.name,
    }))
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}
