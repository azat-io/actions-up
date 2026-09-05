import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

import { getCompatibleUpdate } from '../../core/api/get-compatible-update'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-04T00:00:00.000Z')

function createClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getMatchingTagReferences: vi.fn().mockResolvedValue([]),
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

/**
 * Build a `getTagInfo` mock that answers from a tag-to-age table.
 *
 * @param ages - Tag name mapped to its age in days.
 * @returns Mock resolving each known tag to a dated `TagInfo`.
 */
function createTagInfoMock(
  ages: Record<string, number>,
): GitHubClient['getTagInfo'] {
  return vi.fn((_owner: string, _repo: string, tag: string) => {
    let age = ages[tag]
    return Promise.resolve(
      age === undefined ? null : (
        { date: new Date(NOW - age * DAY), message: null, sha: null, tag }
      ),
    )
  })
}

describe('getCompatibleUpdate', () => {
  it('reports no candidate for non-semver current version without API call', async () => {
    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'main',
      mode: 'minor',
    })

    expect(result).toEqual({ reason: 'no-candidate', update: null })
    expect(client.getAllTags).not.toHaveBeenCalled()
  })

  it('reports no candidate for action name without owner/repo', async () => {
    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'v1.0.0',
      actionName: 'repo-only',
      mode: 'minor',
    })

    expect(result).toEqual({ reason: 'no-candidate', update: null })
  })

  it('reports no candidate for action name with missing owner', async () => {
    let client = createClient()

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'v1.0.0',
      actionName: '/repo',
      mode: 'minor',
    })

    expect(result).toEqual({ reason: 'no-candidate', update: null })
  })

  it('reports no candidate when fetching tags fails', async () => {
    let client = createClient({
      getAllTags: vi.fn().mockRejectedValue(new Error('boom')),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v1.0.0',
      mode: 'minor',
    })

    expect(result).toEqual({ reason: 'no-candidate', update: null })
  })

  it('reports no candidate when no compatible tags exist', async () => {
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

    expect(result).toEqual({ reason: 'no-candidate', update: null })
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

    expect(result).toEqual({
      update: { version: 'v4.3.0', publishedAt: null, sha: 'sha-430' },
      reason: null,
    })
    expect(client.getTagSha).not.toHaveBeenCalled()
    expect(client.getTagInfo).not.toHaveBeenCalled()
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

    expect(result).toEqual({
      update: { sha: 'resolved-sha', version: 'v4.2.4', publishedAt: null },
      reason: null,
    })
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

    expect(result).toEqual({
      update: { version: 'v4.2.4', publishedAt: null, sha: null },
      reason: null,
    })
  })

  it('uses tags and sha caches when provided', async () => {
    let tagsCache = new Map([
      ['owner/repo#', [{ tag: 'v4.2.4', message: null, date: null, sha: '' }]],
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

    expect(result).toEqual({
      update: { sha: 'cached-sha', version: 'v4.2.4', publishedAt: null },
      reason: null,
    })
    expect(client.getAllTags).not.toHaveBeenCalled()
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('returns null sha from cache without calling getTagSha', async () => {
    let tagsCache = new Map([
      ['owner/repo#', [{ tag: 'v4.2.4', message: null, date: null, sha: '' }]],
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

    expect(result).toEqual({
      update: { version: 'v4.2.4', publishedAt: null, sha: null },
      reason: null,
    })
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

    expect(result).toEqual({
      update: { version: 'v2.1.0', publishedAt: null, sha: 'sha-210' },
      reason: null,
    })
    expect(client.getAllTags).toHaveBeenCalledWith('owner', 'repo', 100)
  })

  it('fetches a prefixed family by its own prefix', async () => {
    let client = createClient({
      getMatchingTagReferences: vi
        .fn()
        .mockResolvedValue([
          { tag: 'actions-v0.1.2', message: null, sha: 'sha012', date: null },
        ]),
    })

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'actions-v0.1.1',
      actionName: 'owner/repo',
      mode: 'patch',
    })

    expect(result).toEqual({
      update: { version: 'actions-v0.1.2', publishedAt: null, sha: 'sha012' },
      reason: null,
    })
    expect(client.getMatchingTagReferences).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'repo',
      'actions-',
    )
    expect(client.getAllTags).not.toHaveBeenCalled()
  })

  it('steps down to the newest tag that clears the cool-down', async () => {
    let client = createClient({
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'sha-063', tag: 'v0.6.3', message: null, date: null },
        { sha: 'sha-062', tag: 'v0.6.2', message: null, date: null },
        { sha: 'sha-061', tag: 'v0.6.1', message: null, date: null },
      ]),
      getTagInfo: createTagInfoMock({
        'v0.6.2': 34,
        'v0.6.1': 90,
        'v0.6.3': 5,
      }),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v0.6.0',
      minAgeMs: 7 * DAY,
      mode: 'major',
      now: NOW,
    })

    expect(result).toEqual({
      update: {
        publishedAt: new Date(NOW - 34 * DAY),
        version: 'v0.6.2',
        sha: 'sha-062',
      },
      reason: null,
    })
    expect(client.getTagInfo).toHaveBeenCalledTimes(2)
  })

  it('reports a cool-down when every compatible tag is too young', async () => {
    let client = createClient({
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'sha-063', tag: 'v0.6.3', message: null, date: null },
        { sha: 'sha-062', tag: 'v0.6.2', message: null, date: null },
      ]),
      getTagInfo: createTagInfoMock({ 'v0.6.3': 1, 'v0.6.2': 2 }),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v0.6.0',
      minAgeMs: 7 * DAY,
      mode: 'major',
      now: NOW,
    })

    expect(result).toEqual({ reason: 'cool-down', update: null })
  })

  it('treats an unknown publication date as old enough', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { sha: 'sha-063', tag: 'v0.6.3', message: null, date: null },
        ]),
      getTagInfo: vi.fn().mockResolvedValue(null),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v0.6.0',
      minAgeMs: 7 * DAY,
      mode: 'major',
      now: NOW,
    })

    expect(result).toEqual({
      update: { publishedAt: null, version: 'v0.6.3', sha: 'sha-063' },
      reason: null,
    })
  })

  it('treats a failed date lookup as old enough', async () => {
    let client = createClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { sha: 'sha-063', tag: 'v0.6.3', message: null, date: null },
        ]),
      getTagInfo: vi.fn().mockRejectedValue(new Error('boom')),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v0.6.0',
      minAgeMs: 7 * DAY,
      mode: 'major',
      now: NOW,
    })

    expect(result).toEqual({
      update: { publishedAt: null, version: 'v0.6.3', sha: 'sha-063' },
      reason: null,
    })
  })

  it('takes the tag sha from the date lookup when the listing has none', async () => {
    let client = createClient({
      getTagInfo: vi.fn().mockResolvedValue({
        date: new Date(NOW - 34 * DAY),
        sha: 'sha-from-info',
        tag: 'v0.6.2',
        message: null,
      }),
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { tag: 'v0.6.2', message: null, date: null, sha: null },
        ]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v0.6.0',
      minAgeMs: 7 * DAY,
      mode: 'major',
      now: NOW,
    })

    expect(result).toEqual({
      update: {
        publishedAt: new Date(NOW - 34 * DAY),
        sha: 'sha-from-info',
        version: 'v0.6.2',
      },
      reason: null,
    })
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('honours the mode while stepping down for the cool-down', async () => {
    let client = createClient({
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'sha-200', tag: 'v2.0.0', message: null, date: null },
        { sha: 'sha-130', tag: 'v1.3.0', message: null, date: null },
      ]),
      getTagInfo: createTagInfoMock({ 'v2.0.0': 90, 'v1.3.0': 34 }),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'owner/repo',
      currentVersion: 'v1.2.0',
      minAgeMs: 7 * DAY,
      mode: 'minor',
      now: NOW,
    })

    expect(result).toEqual({
      update: {
        publishedAt: new Date(NOW - 34 * DAY),
        version: 'v1.3.0',
        sha: 'sha-130',
      },
      reason: null,
    })
  })
})
