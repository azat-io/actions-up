import type { GitHubClientContext } from '../../types/github-client-context'

import { makeRequest } from './make-request'

/**
 * Detect whether a reference is a tag or a branch.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.reference - Reference name.
 * @returns 'tag' | 'branch' | null.
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
  try {
    await makeRequest(
      context,
      `/repos/${owner}/${repo}/git/refs/tags/${reference}`,
    )
    context.caches.refType.set(cacheKey, 'tag')
    return 'tag'
  } catch {
    try {
      await makeRequest(
        context,
        `/repos/${owner}/${repo}/git/refs/heads/${reference}`,
      )
      context.caches.refType.set(cacheKey, 'branch')
      return 'branch'
    } catch {
      context.caches.refType.set(cacheKey, null)
      return null
    }
  }
}
