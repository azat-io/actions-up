import type { GitHubClientContext } from '../../types/github-client-context'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Resolve commit SHA for a tag without fetching commit metadata.
 *
 * Prefers annotated tag target when present; otherwise falls back to the
 * lightweight tag (commit) SHA.
 *
 * Uses the exact-match `git/ref/tags` endpoint, so a tag that exists only as a
 * prefix of other tags (e.g. `v8` with only `v8.3.2` published) resolves to
 * null.
 *
 * An annotated tag whose tag object cannot be read resolves to null as well.
 * The reference names the tag object rather than the commit, and pinning that
 * SHA would write a reference that no commit answers to.
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
      `/repos/${owner}/${repo}/git/ref/tags/${displayTag}`,
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
        let tagData = tagResp.data as {
          object: { sha?: string | null; type?: string }
        }
        /**
         * A tag object can point at another tag object rather than at a commit,
         * and that SHA names no commit either.
         */
        sha =
          tagData.object.type === 'commit' ? (tagData.object.sha ?? null) : null
      } catch (tagObjectError) {
        if (isRateLimit(tagObjectError)) {
          throw tagObjectError
        }
        sha = null
      }
    } else if (objectSha && objectType === 'commit') {
      sha = objectSha
    }

    context.caches.tagSha.set(cacheKey, sha)
    return sha
  } catch (error) {
    if (isRateLimit(error)) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    context.caches.tagSha.set(cacheKey, null)
    return null
  }
}

/**
 * Recognize the rate limit that `makeRequest` reports as a rewritten message.
 *
 * @param error - Error thrown by a request.
 * @returns True when the request was rate limited.
 */
function isRateLimit(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('rate limit')
}
