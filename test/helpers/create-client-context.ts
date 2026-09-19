import type { GitHubClientContext } from '../../types/github-client-context'

/**
 * Create a GitHub client context with empty caches for API function tests.
 *
 * @param overrides - Context fields to replace.
 * @returns Fresh client context authenticated with a dummy token.
 */
export function createClientContext(
  overrides: Partial<GitHubClientContext> = {},
): GitHubClientContext {
  return {
    caches: {
      matchingReferences: new Map(),
      refType: new Map(),
      tagInfo: new Map(),
      tagSha: new Map(),
    },
    baseUrl: 'https://api.github.com',
    rateLimitReset: new Date(0),
    rateLimitRemaining: 5000,
    token: 't',
    ...overrides,
  }
}
