import { describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'
import type { GitHubClient } from '../../types/github-client'

import { resolveTargetReference } from '../../core/updates/resolve-target-reference'

class GitHubRateLimitError extends Error {
  public constructor() {
    super('API rate limit exceeded')
    this.name = 'GitHubRateLimitError'
  }
}

function createClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getTagSha: vi
      .fn()
      .mockResolvedValue('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    getAllTags: vi.fn().mockResolvedValue([]),
    shouldWaitForRateLimit: vi.fn(),
    getRateLimitStatus: vi.fn(),
    getLatestRelease: vi.fn(),
    getAllReleases: vi.fn(),
    getRefType: vi.fn(),
    getTagInfo: vi.fn(),
    ...overrides,
  }
}

function createUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    action: {
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
    },
    latestSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    latestVersion: 'v5.0.0',
    currentRefType: 'tag',
    currentVersion: 'v4',
    isBreaking: false,
    publishedAt: null,
    hasUpdate: true,
    ...overrides,
  }
}
describe('resolveTargetReference', () => {
  it('resolves sha target in sha style', async () => {
    let result = await resolveTargetReference(
      createUpdate(),
      'sha',
      createClient(),
    )

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('resolves tag target in preserve style for tag refs', async () => {
    let result = await resolveTargetReference(
      createUpdate(),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBe('v5')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('preserves minor-only tag refs in preserve style', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        latestVersion: 'v4.2.3',
        currentVersion: 'v4.1',
      }),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBe('v4.2')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('falls back to the exact tag when the preserved tag does not exist', async () => {
    let client = createClient({
      getTagSha: vi.fn().mockResolvedValue(null),
    })

    let result = await resolveTargetReference(
      createUpdate({
        latestVersion: 'v8.3.2',
        currentVersion: 'v7',
      }),
      'preserve',
      client,
    )

    expect(result.targetRef).toBe('v8.3.2')
    expect(result.targetRefStyle).toBe('tag')
    expect(client.getTagSha).toHaveBeenCalledWith('actions', 'checkout', 'v8')
  })

  it('falls back to the exact tag when the preserved tag is stale', async () => {
    let client = createClient({
      getTagSha: vi
        .fn()
        .mockResolvedValue('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
    })

    let result = await resolveTargetReference(
      createUpdate({
        latestVersion: 'v8.3.2',
        currentVersion: 'v7',
      }),
      'preserve',
      client,
    )

    expect(result.targetRef).toBe('v8.3.2')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('skips tag validation when the latest version keeps granularity', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v4.2.1',
        latestVersion: 'v4.2.3',
      }),
      'preserve',
      client,
    )

    expect(result.targetRef).toBe('v4.2.3')
    expect(result.targetRefStyle).toBe('tag')
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('marks rate limited fallbacks in preserve style', async () => {
    let rateLimitError = new GitHubRateLimitError()
    let client = createClient({
      getTagSha: vi.fn().mockRejectedValue(rateLimitError),
    })

    let result = await resolveTargetReference(
      createUpdate({
        latestVersion: 'v8.3.2',
        currentVersion: 'v7',
      }),
      'preserve',
      client,
    )

    expect(result.targetRef).toBe('v8.3.2')
    expect(result.targetRefRateLimited).toBeTruthy()
  })

  it('returns null target when current version is missing for tag refs', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: null,
      }),
      'preserve',
      client,
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('returns null target when preserve style cannot keep tag granularity', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v4.1',
        latestVersion: 'v5',
      }),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('keeps sha target in preserve style for sha refs', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'abcdef1',
        currentRefType: 'sha',
      }),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('returns null target when sha style has no sha', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        latestSha: null,
      }),
      'sha',
      createClient(),
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when preserve style cannot preserve ref type', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        currentRefType: 'branch',
      }),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when preserve style keeps sha refs but latest sha is missing', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'abcdef1',
        currentRefType: 'sha',
        latestSha: null,
      }),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when update is not actionable', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        hasUpdate: false,
      }),
      'preserve',
      createClient(),
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })
})
