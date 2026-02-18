import type { GitHubClientContext } from '../../types/github-client-context'

import { updateRateLimitInfo } from './update-rate-limit-info'

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
 * @param context - Client context with token and rate-limit state.
 * @param path - API path beginning with '/'.
 * @param options - Request init options.
 * @returns Response headers and parsed data.
 */
export async function makeRequest(
  context: GitHubClientContext,
  path: string,
  options: RequestInit = {},
): Promise<{ headers: Record<string, string>; data: unknown }> {
  let headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'actions-up',
    ...(options.headers as Record<string, string>),
  }

  if (context.token) {
    headers['Authorization'] = `Bearer ${context.token}`
  }

  let response = (await fetch(`${context.baseUrl}${path}`, {
    ...options,
    headers,
  })) as unknown as FetchResponseLike

  let responseHeaders: Record<string, string> = {}
  for (let [key, value] of response.headers.entries()) {
    responseHeaders[key] = value
  }

  updateRateLimitInfo(context, responseHeaders)

  if (!response.ok) {
    let error = new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    ) as { status?: number } & Error
    error.status = response.status

    if (response.status === 403) {
      let text = await response.text()
      if (text.includes('rate limit') || text.includes('API rate limit')) {
        error.message = 'API rate limit exceeded'
      }
    }

    throw error
  }

  let data = await response.json()
  return { headers: responseHeaders, data }
}
