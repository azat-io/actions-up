import type { GitHubClientContext } from '../../types/github-client-context'
import type { TagInfo } from '../../types/tag-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * List tag references whose name starts with the given prefix.
 *
 * Unlike the tags listing, this endpoint filters server-side and returns the
 * whole matching set in one response, so a tag family stays reachable in
 * repositories where it would otherwise fall outside the first page.
 *
 * An annotated tag reports the SHA of its tag object rather than of the commit
 * it points at, so those entries carry a null SHA and leave dereferencing to
 * the callers that already handle it.
 *
 * The endpoint answers an existing repository with an empty list when no tag
 * matches, so a 404 means the repository itself is missing or hidden from the
 * current credentials. Reading it as an empty family would report a missing
 * repository as a tag family without members, so it reaches the caller instead.
 * Any other failure is read as no matching tags.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.prefix - Tag name prefix to match.
 * @returns Matching tags, or an empty array when nothing matches.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the repository was not found, with status 404.
 */
export async function getMatchingTagReferences(
  context: GitHubClientContext,
  parameters: { prefix: string; owner: string; repo: string },
): Promise<TagInfo[]> {
  let { prefix, owner, repo } = parameters

  let cacheKey = `${owner}/${repo}#${prefix}`
  if (context.caches.matchingReferences.has(cacheKey)) {
    return context.caches.matchingReferences.get(cacheKey)!
  }

  try {
    let response = await makeRequest(
      context,
      `/repos/${owner}/${repo}/git/matching-refs/tags/${prefix}`,
    )
    let references = response.data as {
      object: { type: 'commit' | 'tag'; sha: string }
      ref: string
    }[]

    let tags = references.map(reference => ({
      sha: reference.object.type === 'commit' ? reference.object.sha : null,
      tag: reference.ref.replace(/^refs\/tags\//u, ''),
      message: null,
      date: null,
    }))

    context.caches.matchingReferences.set(cacheKey, tags)
    return tags
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 404
    ) {
      throw error
    }
    context.caches.matchingReferences.set(cacheKey, [])
    return []
  }
}
