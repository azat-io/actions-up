import type { GitHubClientContext } from '../../types/github-client-context'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Resolve commit SHA for a tag without fetching commit metadata.
 *
 * Prefers annotated tag target when present; otherwise falls back to the
 * lightweight tag (commit) SHA.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name (may include 'refs/tags/' prefix).
 * @returns Commit SHA or null if it cannot be determined.
 */
export async function getTagSha(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string; tag: string },
): Promise<string | null> {
  let { owner, repo, tag } = parameters

  let displayTag = tag.replace(/^refs\/tags\//u, '')
  let cacheKey = `${owner}/${repo}#${displayTag}`
  if (context.caches.tagSha.has(cacheKey)) {
    return context.caches.tagSha.get(cacheKey) ?? null
  }

  try {
    let referenceResp = await makeRequest(
      context,
      `/repos/${owner}/${repo}/git/refs/tags/${displayTag}`,
    )
    let referenceData = referenceResp.data as {
      object: { type: 'commit' | 'tag'; sha: string }
    }

    let objectSha = referenceData.object.sha
    let objectType = referenceData.object.type
    let sha: string | null = null

    if (objectSha && objectType === 'tag') {
      try {
        let tagResp = await makeRequest(
          context,
          `/repos/${owner}/${repo}/git/tags/${objectSha}`,
        )
        let tagData = tagResp.data as { object: { sha?: string | null } }
        sha = tagData.object.sha ?? null
      } catch {
        sha = objectSha
      }
    } else if (objectSha && objectType === 'commit') {
      sha = objectSha
    }

    context.caches.tagSha.set(cacheKey, sha)
    return sha
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    context.caches.tagSha.set(cacheKey, null)
    return null
  }
}
