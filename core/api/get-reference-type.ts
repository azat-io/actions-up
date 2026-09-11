import type { GitHubClientContext } from '../../types/github-client-context'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Detect whether a reference is a tag or a branch.
 *
 * Uses the exact-match `git/ref` endpoints, so a reference that only matches
 * existing refs as a prefix is not reported as a tag or a branch.
 *
 * Only a pair of 404 answers resolves to `null`. A request that failed for any
 * other reason leaves the reference type unanswered, and a caller that read
 * such a failure as "neither a tag nor a branch" would rewrite a floating
 * reference it was asked to leave alone, so the failure is reported instead.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.reference - Reference name.
 * @returns 'tag' | 'branch' | null.
 * @throws GitHubRateLimitError - When a request was rate limited.
 * @throws Error - When a request failed for any reason other than a 404, so the
 *   reference type stays unknown.
 */
export async function getReferenceType(
  context: GitHubClientContext,
  parameters: { reference: string; owner: string; repo: string },
): Promise<'branch' | 'tag' | null> {
  let { reference, owner, repo } = parameters
  let cacheKey = `${owner}/${repo}#${reference}`
  if (context.caches.refType.has(cacheKey)) {
    return context.caches.refType.get(cacheKey) ?? null
  }

  let isTag = await referenceExists(
    context,
    `/repos/${owner}/${repo}/git/ref/tags/${reference}`,
  )
  if (isTag) {
    context.caches.refType.set(cacheKey, 'tag')
    return 'tag'
  }

  let isBranch = await referenceExists(
    context,
    `/repos/${owner}/${repo}/git/ref/heads/${reference}`,
  )
  if (isBranch) {
    context.caches.refType.set(cacheKey, 'branch')
    return 'branch'
  }

  context.caches.refType.set(cacheKey, null)
  return null
}

/**
 * Check whether an exact-match reference endpoint resolves.
 *
 * A failed request is not an answer, so it reaches the caller instead of being
 * cached as a missing reference.
 *
 * @param context - Client context.
 * @param path - Exact-match `git/ref` endpoint path.
 * @returns True when the reference exists, false when the endpoint answered
 *   with a 404.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the request failed for any other reason.
 */
async function referenceExists(
  context: GitHubClientContext,
  path: string,
): Promise<boolean> {
  try {
    await makeRequest(context, path)
    return true
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 404
    ) {
      return false
    }

    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }

    throw error
  }
}
