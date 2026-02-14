import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

import { getCompatibleUpdate } from '../../core/api/get-compatible-update'

function createClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getTagSha: vi.fn().mockResolvedValue(null),
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

describe('getCompatibleUpdate', () => {
  it('returns null for non-semver current version without API call', async () => {
    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'main',
      mode: 'minor',
    })

    expect(result).toBeNull()
    expect(client.getAllTags).not.toHaveBeenCalled()
  })

  it('returns null for action name without owner/repo', async () => {
    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'v1.0.0',
      actionName: 'repo-only',
      mode: 'minor',
    })

    expect(result).toBeNull()
  })

  it('returns null for action name with missing owner', async () => {
    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'v1.0.0',
      actionName: '/repo',
      mode: 'minor',
    })

    expect(result).toBeNull()
  })

  it('returns null when fetching tags fails', async () => {
    let client = createClient({
      getAllTags: vi.fn().mockRejectedValue(new Error('boom')),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v1.0.0',
      mode: 'minor',
    })

    expect(result).toBeNull()
  })

  it('returns null when no compatible tags exist', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { sha: 'sha-500', tag: 'v5.0.0', message: null, date: null },
        ]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v4.2.0',
      mode: 'minor',
    })

    expect(result).toBeNull()
  })

  it('returns compatible tag with sha from tags list', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { sha: 'sha-430', tag: 'v4.3.0', message: null, date: null },
        ]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v4.1.0',
      mode: 'minor',
    })

    expect(result).toEqual({ version: 'v4.3.0', sha: 'sha-430' })
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('resolves missing tag sha via getTagSha', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { tag: 'v4.2.4', message: null, date: null, sha: '' },
        ]),
      getTagSha: vi.fn().mockResolvedValue('resolved-sha'),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v4.2.0',
      mode: 'patch',
    })

    expect(result).toEqual({ sha: 'resolved-sha', version: 'v4.2.4' })
    expect(client.getTagSha).toHaveBeenCalledWith('owner', 'repo', 'v4.2.4')
  })

  it('returns compatible version with null sha when getTagSha fails', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { tag: 'v4.2.4', message: null, date: null, sha: null },
        ]),
      getTagSha: vi.fn().mockRejectedValue(new Error('no sha')),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v4.2.0',
      mode: 'patch',
    })

    expect(result).toEqual({ version: 'v4.2.4', sha: null })
  })

  it('uses tags and sha caches when provided', async () => {
    let tagsCache = new Map([
      ['owner/repo', [{ tag: 'v4.2.4', message: null, date: null, sha: '' }]],
    ])
    let shaCache = new Map<string, string | null>([
      ['owner/repo@v4.2.4', 'cached-sha'],
    ])

    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v4.2.0',
      mode: 'patch',
      tagsCache,
      shaCache,
    })

    expect(result).toEqual({ version: 'v4.2.4', sha: 'cached-sha' })
    expect(client.getAllTags).not.toHaveBeenCalled()
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('returns null sha from cache without calling getTagSha', async () => {
    let tagsCache = new Map([
      ['owner/repo', [{ tag: 'v4.2.4', message: null, date: null, sha: '' }]],
    ])
    let shaCache = new Map<string, string | null>([['owner/repo@v4.2.4', null]])

    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v4.2.0',
      mode: 'patch',
      tagsCache,
      shaCache,
    })

    expect(result).toEqual({ version: 'v4.2.4', sha: null })
    expect(client.getAllTags).not.toHaveBeenCalled()
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('supports action names with path suffix', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { tag: 'v2.1.0', message: null, date: null, sha: null },
        ]),
      getTagSha: vi.fn().mockResolvedValue('sha-210'),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo/sub/path',
      currentVersion: 'v2.0.0',
      mode: 'minor',
    })

    expect(result).toEqual({ version: 'v2.1.0', sha: 'sha-210' })
    expect(client.getAllTags).toHaveBeenCalledWith('owner', 'repo', 100)
  })
})
