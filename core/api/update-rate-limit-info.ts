import type { GitHubClientContext } from '../../types/github-client-context'

/**
 * Update rate limit information from response headers.
 *
 * @param context - Client context with mutable rate limit fields.
 * @param headers - Response headers map.
 */
export function updateRateLimitInfo(
  context: GitHubClientContext,
  headers: Record<string, undefined | string | number>,
): void {
  let remaining = headers['x-ratelimit-remaining']

  if (remaining !== undefined) {
    context.rateLimitRemaining =
      typeof remaining === 'string' ? Number.parseInt(remaining, 10) : remaining
  }

  let reset = headers['x-ratelimit-reset']
  if (reset !== undefined) {
    let resetTime =
      typeof reset === 'string' ? Number.parseInt(reset, 10) : reset
    context.rateLimitReset = new Date(resetTime * 1000)
  }
}
