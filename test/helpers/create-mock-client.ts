import { vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

/**
 * Create a GitHub client whose methods are all mocks.
 *
 * Every lookup answers as if the repository had nothing: listings resolve to
 * empty arrays and single lookups resolve to null, so a comparison finds no
 * shared history, the tip of a branch at a past moment is unknown, and no
 * commit passes the trust checks unless a test says otherwise. The default
 * branch is `main`. The rate limit helpers are bare mocks.
 *
 * @param overrides - Methods to replace.
 * @returns Mocked GitHub client.
 */
export function createMockClient(
  overrides: Partial<GitHubClient> = {},
): GitHubClient {
  return {
    getMatchingTagReferences: vi.fn().mockResolvedValue([]),
    getProtectedBranches: vi.fn().mockResolvedValue([]),
    getDefaultBranch: vi.fn().mockResolvedValue('main'),
    getLatestRelease: vi.fn().mockResolvedValue(null),
    getReleaseByTag: vi.fn().mockResolvedValue(null),
    compareCommits: vi.fn().mockResolvedValue(null),
    getBranchTipAt: vi.fn().mockResolvedValue(null),
    getAllReleases: vi.fn().mockResolvedValue([]),
    getRefType: vi.fn().mockResolvedValue(null),
    getTagSha: vi.fn().mockResolvedValue(null),
    getAllTags: vi.fn().mockResolvedValue([]),
    shouldWaitForRateLimit: vi.fn(),
    getRateLimitStatus: vi.fn(),
    ...overrides,
  }
}
