import { vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

/**
 * Create a GitHub client whose methods are all mocks.
 *
 * Every lookup answers as if the repository had nothing: listings resolve to
 * empty arrays and single lookups resolve to null. The rate limit helpers are
 * bare mocks.
 *
 * @param overrides - Methods to replace.
 * @returns Mocked GitHub client.
 */
export function createMockClient(
  overrides: Partial<GitHubClient> = {},
): GitHubClient {
  return {
    getMatchingTagReferences: vi.fn().mockResolvedValue([]),
    getLatestRelease: vi.fn().mockResolvedValue(null),
    getAllReleases: vi.fn().mockResolvedValue([]),
    getTagInfo: vi.fn().mockResolvedValue(null),
    getRefType: vi.fn().mockResolvedValue(null),
    getTagSha: vi.fn().mockResolvedValue(null),
    getAllTags: vi.fn().mockResolvedValue([]),
    shouldWaitForRateLimit: vi.fn(),
    getRateLimitStatus: vi.fn(),
    ...overrides,
  }
}
