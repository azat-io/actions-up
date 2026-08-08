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
    let result = await resolveTargetReference(createUpdate(), {
      client: createClient(),
      style: 'sha',
    })

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('resolves tag target in preserve style for tag refs', async () => {
    let result = await resolveTargetReference(createUpdate(), {
      client: createClient(),
      style: 'preserve',
    })

    expect(result.targetRef).toBe('v5')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('preserves minor-only tag refs in preserve style', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        latestVersion: 'v4.2.3',
        currentVersion: 'v4.1',
      }),
      { client: createClient(), style: 'preserve' },
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
      { style: 'preserve', client },
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
      { style: 'preserve', client },
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
      { style: 'preserve', client },
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
      { style: 'preserve', client },
    )

    expect(result.targetRef).toBe('v8.3.2')
    expect(result.targetRefRateLimited).toBeTruthy()
  })

  it('rewrites to the canonical major tag in semver style', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v4.2.1',
        latestVersion: 'v7.0.1',
      }),
      { style: 'semver', mode: 'major', client },
    )

    expect(result.targetRef).toBe('v7')
    expect(result.targetRefStyle).toBe('tag')
    expect(client.getTagSha).toHaveBeenCalledWith('actions', 'checkout', 'v7')
  })

  it('rewrites to the canonical minor tag in semver patch mode', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v4.2.1',
        latestVersion: 'v4.2.3',
      }),
      { style: 'semver', mode: 'patch', client },
    )

    expect(result.targetRef).toBe('v4.2')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('falls back to the exact tag in semver style when no canonical tag exists', async () => {
    let client = createClient({
      getTagSha: vi.fn().mockResolvedValue(null),
    })

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v7.1.2',
        latestVersion: 'v8.3.2',
      }),
      { style: 'semver', mode: 'major', client },
    )

    expect(result.targetRef).toBe('v8.3.2')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('defaults to major granularity in semver style without explicit mode', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        latestVersion: 'v7.0.1',
        currentVersion: 'v4',
      }),
      { style: 'semver', client },
    )

    expect(result.targetRef).toBe('v7')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('marks rate limited fallbacks in semver style', async () => {
    let rateLimitError = new GitHubRateLimitError()
    let client = createClient({
      getTagSha: vi.fn().mockRejectedValue(rateLimitError),
    })

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v7.1.2',
        latestVersion: 'v8.3.2',
      }),
      { style: 'semver', mode: 'major', client },
    )

    expect(result.targetRef).toBe('v8.3.2')
    expect(result.targetRefRateLimited).toBeTruthy()
  })

  it('writes major-only latest as is in semver style without validation', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'v5.1.0',
        latestVersion: 'v6',
      }),
      { style: 'semver', mode: 'major', client },
    )

    expect(result.targetRef).toBe('v6')
    expect(result.targetRefStyle).toBe('tag')
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('keeps sha target in semver style for sha refs', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: 'abcdef1',
        currentRefType: 'sha',
      }),
      { client: createClient(), style: 'semver' },
    )

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('returns null target when current version is missing for tag refs', async () => {
    let client = createClient()

    let result = await resolveTargetReference(
      createUpdate({
        currentVersion: null,
      }),
      { style: 'preserve', client },
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
      { client: createClient(), style: 'preserve' },
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
      { client: createClient(), style: 'preserve' },
    )

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('returns null target when sha style has no sha', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        latestSha: null,
      }),
      { client: createClient(), style: 'sha' },
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when preserve style cannot preserve ref type', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        currentRefType: 'branch',
      }),
      { client: createClient(), style: 'preserve' },
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
      { client: createClient(), style: 'preserve' },
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when update is not actionable', async () => {
    let result = await resolveTargetReference(
      createUpdate({
        hasUpdate: false,
      }),
      { client: createClient(), style: 'preserve' },
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })
})
