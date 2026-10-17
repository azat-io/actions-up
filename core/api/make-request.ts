import type {
  GitHubClientContext,
  GitHubResponse,
} from '../../types/github-client-context'

import { updateRateLimitInfo } from './update-rate-limit-info'

/**
 * Time a request may take before it is abandoned. GitHub answers within a
 * second or two, so a request still pending after this long has stalled, and
 * waiting on it would hold up the whole run.
 */
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Minimal subset of the Fetch API Response interface used by this module.
 * Implementations (node, polyfills, test doubles) must provide these members.
 */
interface FetchResponseLike {
  /**
   * Response headers iterator.
   */
  headers: { entries(): IterableIterator<[string, string]> }

  /**
   * Parse body as JSON.
   */
  json(): Promise<unknown>

  /**
   * Read body as text (used to detect rate limit messages).
   */
  text(): Promise<string>

  /**
   * Status text provided by the server (e.g., "Forbidden").
   */
  statusText: string

  /**
   * Numeric HTTP status code.
   */
  status: number

  /**
   * True when HTTP status indicates success (2xx).
   */
  ok: boolean
}

/**
 * Perform an HTTP request against GitHub API with auth and rate-limit updates.
 *
 * Each path is requested once per client. A lookup that repeats a request
 * shares the response of the first one, even while it is still in flight.
 * Successful responses and missing resources are answers and stay shared for
 * the whole run; any other failure is dropped once it settles, so a later
 * lookup asks again.
 *
 * Requests go out within the limits of the client, and once GitHub answers one
 * with a rate limit, every request still waiting and every later one is refused
 * with that rate limit instead of being sent.
 *
 * @param context - Client context with token and rate-limit state.
 * @param path - API path beginning with '/'.
 * @returns Response headers and parsed data.
 */
export function makeRequest(
  context: GitHubClientContext,
  path: string,
): Promise<GitHubResponse> {
  let known = context.responses.get(path)
  if (known) {
    return known
  }

  let response = requestOnce(context, path)
  context.responses.set(path, response)
  return response
}

/**
 * Send a single request to the GitHub API.
 *
 * @param context - Client context with token and rate-limit state.
 * @param path - API path beginning with '/'.
 * @returns Response headers and parsed data.
 */
async function sendRequest(
  context: GitHubClientContext,
  path: string,
): Promise<GitHubResponse> {
  let headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'actions-up',
  }

  if (context.token) {
    headers['Authorization'] = `Bearer ${context.token}`
  }

  let response: FetchResponseLike = await fetch(`${context.baseUrl}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers,
  })

  let responseHeaders: Record<string, string> = Object.fromEntries(
    response.headers.entries(),
  )

  /**
   * Once a request ran into a rate limit, the reset moment it announced stays
   * in force. The responses of requests still in flight would otherwise replace
   * it with whatever window they report, and the run fails with an error that
   * names it.
   */
  if (!context.limiter.isStopped()) {
    updateRateLimitInfo(context, responseHeaders)
  }

  if (!response.ok) {
    let error = new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    ) as { status?: number } & Error
    error.status = response.status

    if (await isRateLimitedResponse(response)) {
      error.message = 'API rate limit exceeded'
      if (!context.limiter.isStopped()) {
        recordRetryAfter(context, responseHeaders)
      }
      context.limiter.stop(error)
    }

    throw error
  }

  let data = await response.json()
  return { headers: responseHeaders, data }
}

/**
 * Take the wait a rate-limited response asks for as the moment the limit
 * resets.
 *
 * A secondary rate limit names its own wait in `retry-after`, which can end
 * long before the primary window announced by `x-ratelimit-reset` does.
 *
 * @param context - Client context whose reset moment is updated.
 * @param headers - Headers of the rate-limited response.
 */
function recordRetryAfter(
  context: GitHubClientContext,
  headers: Record<string, string>,
): void {
  let retryAfter = headers['retry-after']

  if (retryAfter === undefined || !/^\d+$/u.test(retryAfter)) {
    return
  }

  context.rateLimitReset = new Date(
    Date.now() + Number.parseInt(retryAfter, 10) * 1000,
  )
}

/**
 * Send a request for a path no lookup has asked for yet, and forget its outcome
 * again when it failed for any reason other than a missing resource.
 *
 * @param context - Client context with token and rate-limit state.
 * @param path - API path beginning with '/'.
 * @returns Response headers and parsed data.
 */
async function requestOnce(
  context: GitHubClientContext,
  path: string,
): Promise<GitHubResponse> {
  try {
    return await context.limiter.schedule(() => sendRequest(context, path))
  } catch (error) {
    if (!isNotFoundError(error)) {
      context.responses.delete(path)
    }
    throw error
  }
}

/**
 * Tell a rate-limited response apart from any other refusal.
 *
 * GitHub answers both the primary and the secondary rate limit with either a
 * 403 or a 429. A 429 means nothing else, while a 403 is also how GitHub
 * refuses a request for lack of permission, so its body has to name the limit.
 *
 * @param response - Unsuccessful response.
 * @returns True when the request was rate limited.
 */
async function isRateLimitedResponse(
  response: FetchResponseLike,
): Promise<boolean> {
  if (response.status === 429) {
    return true
  }

  if (response.status !== 403) {
    return false
  }

  let text = await response.text()
  return text.includes('rate limit')
}

/**
 * Recognize the error a request fails with when GitHub answers with a 404.
 *
 * @param error - Error a request failed with.
 * @returns True when the resource does not exist.
 */
function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 404
}
