import type { GitHubClientContext } from '../../types/github-client-context'
import type { TagInfo } from '../../types/tag-info'

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
 */
export async function getAllTags(
  context: GitHubClientContext,
  parameters: { limit?: number; owner: string; repo: string },
): Promise<TagInfo[]> {
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
    message: null,
    date: null,
  }))
}
