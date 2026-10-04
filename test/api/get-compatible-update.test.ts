import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'
import type { TagInfo } from '../../types/tag-info'

import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { getCompatibleUpdate } from '../../core/api/get-compatible-update'
import { createMockClient } from '../helpers/create-mock-client'

const NOW = Date.parse('2026-09-04T00:00:00.000Z')

const COOL_DOWN_MS = 7 * 24 * 60 * 60 * 1000

const NEWEST_SHA = '805273f7cf5a6c5f549c155c4c9ea2a3f78711bd'

const MIDDLE_SHA = '7a77659a7a7a67d8387e6c494999a688e249db6c'

const OLDEST_SHA = 'a01a2d3bc2c9de000948b5a3a85b455b4f72d97a'

const RESOLVED_SHA = '0101ea7a85725b7e03969261d139b4f282b7a8f3'

/**
 * `getTagInfo` that answers with the publication date of each known tag and
 * with null for any other tag.
 *
 * @param dates - Tag name mapped to its publication date.
 * @returns Mocked `getTagInfo`.
 */
function tagInfoByDate(
  dates: Record<string, Date>,
): GitHubClient['getTagInfo'] {
  return vi.fn((_owner: string, _repo: string, tag: string) => {
    let date = dates[tag]
    return Promise.resolve(
      date ? { message: null, sha: null, date, tag } : null,
    )
  })
}

/**
 * Tag as a listing reports it, without metadata.
 *
 * @param tag - Tag name.
 * @param sha - Commit SHA, null when the listing leaves it unresolved.
 * @returns Fresh tag entry.
 */
function makeTag(tag: string, sha: string | null): TagInfo {
  return { message: null, date: null, sha, tag }
}

/**
 * Publication date weeks before the cool-down ends.
 *
 * @returns Fresh date.
 */
function oldEnough(): Date {
  return new Date('2026-07-31T00:00:00.000Z')
}

/**
 * Publication date two days before `NOW`, inside the cool-down.
 *
 * @returns Fresh date.
 */
function tooYoung(): Date {
  return new Date('2026-09-02T00:00:00.000Z')
}

describe('getCompatibleUpdate', () => {
  it('reports no candidate for a reference that is not a version, without listing tags', async () => {
    let client = createMockClient()

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'main',
      mode: 'minor',
    })

    expect(result).toStrictEqual({ reason: 'no-candidate', update: null })
    expect(client.getAllTags).not.toHaveBeenCalled()
    expect(client.getMatchingTagReferences).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'without a slash', actionName: 'checkout' },
    { description: 'without an owner', actionName: '/checkout' },
    { description: 'without a repository', actionName: 'actions/' },
  ])(
    'reports no candidate for an action name $description',
    async ({ actionName }) => {
      let client = createMockClient({
        getAllTags: vi.fn().mockResolvedValue([makeTag('v1.1.0', NEWEST_SHA)]),
      })

      let result = await getCompatibleUpdate(client, {
        currentVersion: 'v1.0.0',
        mode: 'minor',
        actionName,
      })

      expect(result).toStrictEqual({ reason: 'no-candidate', update: null })
    },
  )

  it('reports no candidate when the tag listing fails', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      mode: 'minor',
    })

    expect(result).toStrictEqual({ reason: 'no-candidate', update: null })
  })

  it('reports no candidate when no listed tag is compatible', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockResolvedValue([makeTag('v5.0.0', NEWEST_SHA)]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v4.2.0',
      mode: 'minor',
    })

    expect(result).toStrictEqual({ reason: 'no-candidate', update: null })
  })

  it('offers the newest compatible tag with the SHA from the listing, without further lookups', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockResolvedValue([makeTag('v4.3.0', NEWEST_SHA)]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v4.1.0',
      mode: 'minor',
    })

    expect(result).toStrictEqual({
      update: { publishedAt: null, version: 'v4.3.0', sha: NEWEST_SHA },
      reason: null,
    })
    expect(client.getTagSha).not.toHaveBeenCalled()
    expect(client.getTagInfo).not.toHaveBeenCalled()
  })

  it.each([
    { mode: 'major' as const, version: 'v2.0.0', sha: NEWEST_SHA },
    { mode: 'minor' as const, version: 'v1.3.0', sha: MIDDLE_SHA },
    { mode: 'patch' as const, version: 'v1.2.1', sha: OLDEST_SHA },
  ])(
    'offers the newest tag that the $mode mode allows',
    async ({ version, mode, sha }) => {
      let client = createMockClient({
        getAllTags: vi
          .fn()
          .mockResolvedValue([
            makeTag('v2.0.0', NEWEST_SHA),
            makeTag('v1.3.0', MIDDLE_SHA),
            makeTag('v1.2.1', OLDEST_SHA),
          ]),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.2.0',
        mode,
      })

      expect(result).toStrictEqual({
        update: { publishedAt: null, version, sha },
        reason: null,
      })
    },
  )

  it('never offers a tag above the latest version', async () => {
    let client = createMockClient({
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          makeTag('v1.3.0', NEWEST_SHA),
          makeTag('v1.2.5', MIDDLE_SHA),
        ]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.2.0',
      latestVersion: 'v1.2.5',
      mode: 'minor',
    })

    expect(result).toStrictEqual({
      update: { publishedAt: null, version: 'v1.2.5', sha: MIDDLE_SHA },
      reason: null,
    })
  })

  it('resolves the SHA of a tag that the listing leaves unresolved', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockResolvedValue([makeTag('v4.2.4', null)]),
      getTagSha: vi.fn().mockResolvedValue(RESOLVED_SHA),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v4.2.0',
      mode: 'patch',
    })

    expect(result).toStrictEqual({
      update: { publishedAt: null, sha: RESOLVED_SHA, version: 'v4.2.4' },
      reason: null,
    })
    expect(client.getTagSha).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      'v4.2.4',
    )
  })

  it('offers the tag without a SHA when its SHA cannot be resolved', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockResolvedValue([makeTag('v4.2.4', null)]),
      getTagSha: vi.fn().mockResolvedValue(null),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v4.2.0',
      mode: 'patch',
    })

    expect(result).toStrictEqual({
      update: { publishedAt: null, version: 'v4.2.4', sha: null },
      reason: null,
    })
  })

  it('lists the tags of the repository that an action path belongs to', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockResolvedValue([makeTag('v2.1.0', NEWEST_SHA)]),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout/sub/path',
      currentVersion: 'v2.0.0',
      mode: 'minor',
    })

    expect(result).toStrictEqual({
      update: { publishedAt: null, version: 'v2.1.0', sha: NEWEST_SHA },
      reason: null,
    })
    expect(client.getAllTags).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      expect.any(Number),
    )
  })

  it('lists a prefixed tag family by its own prefix', async () => {
    let client = createMockClient({
      getMatchingTagReferences: vi
        .fn()
        .mockResolvedValue([makeTag('actions-v0.1.2', NEWEST_SHA)]),
    })

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'actions-v0.1.1',
      actionName: 'actions/checkout',
      mode: 'patch',
    })

    expect(result).toStrictEqual({
      update: { version: 'actions-v0.1.2', publishedAt: null, sha: NEWEST_SHA },
      reason: null,
    })
    expect(client.getMatchingTagReferences).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      'actions-',
    )
    expect(client.getAllTags).not.toHaveBeenCalled()
  })

  it('lists the tags once for lookups that share a tags cache', async () => {
    let client = createMockClient({
      getAllTags: vi.fn().mockResolvedValue([makeTag('v4.3.0', NEWEST_SHA)]),
    })
    let parameters = {
      tagsCache: new Map<string, TagInfo[]>(),
      actionName: 'actions/checkout',
      currentVersion: 'v4.1.0',
      mode: 'minor' as const,
    }

    let first = await getCompatibleUpdate(client, parameters)
    let second = await getCompatibleUpdate(client, parameters)

    expect(second).toStrictEqual(first)
    expect(client.getAllTags).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      expect.any(Number),
    )
  })

  it.each([
    { description: 'a resolved SHA', sha: RESOLVED_SHA },
    { description: 'an unresolved SHA', sha: null },
  ])(
    'looks $description up once for lookups that share a SHA cache',
    async ({ sha }) => {
      let client = createMockClient({
        getAllTags: vi.fn().mockResolvedValue([makeTag('v4.2.4', null)]),
        getTagSha: vi.fn().mockResolvedValue(sha),
      })
      let parameters = {
        shaCache: new Map<string, string | null>(),
        actionName: 'actions/checkout',
        currentVersion: 'v4.2.0',
        mode: 'patch' as const,
      }

      let first = await getCompatibleUpdate(client, parameters)
      let second = await getCompatibleUpdate(client, parameters)

      expect([first, second]).toStrictEqual([
        { update: { publishedAt: null, version: 'v4.2.4', sha }, reason: null },
        { update: { publishedAt: null, version: 'v4.2.4', sha }, reason: null },
      ])
      expect(client.getTagSha).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        'v4.2.4',
      )
    },
  )

  describe('with a cool-down', () => {
    it('steps down to the newest tag that clears the cool-down, without dating older tags', async () => {
      let client = createMockClient({
        getAllTags: vi
          .fn()
          .mockResolvedValue([
            makeTag('v0.6.3', NEWEST_SHA),
            makeTag('v0.6.2', MIDDLE_SHA),
            makeTag('v0.6.1', OLDEST_SHA),
          ]),
        getTagInfo: tagInfoByDate({
          'v0.6.2': oldEnough(),
          'v0.6.1': oldEnough(),
          'v0.6.3': tooYoung(),
        }),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v0.6.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'major',
        now: NOW,
      })

      expect(result).toStrictEqual({
        update: {
          publishedAt: oldEnough(),
          version: 'v0.6.2',
          sha: MIDDLE_SHA,
        },
        reason: null,
      })
      expect(client.getTagInfo).toHaveBeenCalledTimes(2)
    })

    it('reports a cool-down when every compatible tag is too young', async () => {
      let client = createMockClient({
        getAllTags: vi
          .fn()
          .mockResolvedValue([
            makeTag('v0.6.3', NEWEST_SHA),
            makeTag('v0.6.2', MIDDLE_SHA),
          ]),
        getTagInfo: tagInfoByDate({
          'v0.6.3': tooYoung(),
          'v0.6.2': tooYoung(),
        }),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v0.6.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'major',
        now: NOW,
      })

      expect(result).toStrictEqual({ reason: 'cool-down', update: null })
    })

    it.each([
      {
        description: 'one millisecond less than the cool-down',
        expected: { reason: 'cool-down', update: null },
        publishedAt: new Date(NOW - COOL_DOWN_MS + 1),
        verdict: 'holds back',
      },
      {
        expected: {
          update: {
            publishedAt: new Date(NOW - COOL_DOWN_MS),
            version: 'v0.6.3',
            sha: NEWEST_SHA,
          },
          reason: null,
        },
        publishedAt: new Date(NOW - COOL_DOWN_MS),
        description: 'exactly the cool-down',
        verdict: 'offers',
      },
      {
        expected: {
          update: {
            publishedAt: new Date(NOW - COOL_DOWN_MS - 1),
            version: 'v0.6.3',
            sha: NEWEST_SHA,
          },
          reason: null,
        },
        description: 'one millisecond more than the cool-down',
        publishedAt: new Date(NOW - COOL_DOWN_MS - 1),
        verdict: 'offers',
      },
    ])(
      '$verdict a tag published $description ago',
      async ({ publishedAt, expected }) => {
        let client = createMockClient({
          getAllTags: vi
            .fn()
            .mockResolvedValue([makeTag('v0.6.3', NEWEST_SHA)]),
          getTagInfo: tagInfoByDate({ 'v0.6.3': publishedAt }),
        })

        let result = await getCompatibleUpdate(client, {
          actionName: 'actions/checkout',
          currentVersion: 'v0.6.0',
          minAgeMs: COOL_DOWN_MS,
          mode: 'major',
          now: NOW,
        })

        expect(result).toStrictEqual(expected)
      },
    )

    it('treats an unknown publication date as old enough', async () => {
      let client = createMockClient({
        getAllTags: vi.fn().mockResolvedValue([makeTag('v0.6.3', NEWEST_SHA)]),
        getTagInfo: vi.fn().mockResolvedValue(null),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v0.6.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'major',
        now: NOW,
      })

      expect(result).toStrictEqual({
        update: { publishedAt: null, version: 'v0.6.3', sha: NEWEST_SHA },
        reason: null,
      })
    })

    it('reports a rate-limited date lookup instead of treating it as old enough', async () => {
      let rateLimit = new GitHubRateLimitError(
        new Date('2026-09-04T01:00:00.000Z'),
      )
      let client = createMockClient({
        getAllTags: vi.fn().mockResolvedValue([makeTag('v0.6.3', NEWEST_SHA)]),
        getTagInfo: vi.fn().mockRejectedValue(rateLimit),
      })

      let lookup = getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v0.6.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'major',
        now: NOW,
      })

      await expect(lookup).rejects.toBe(rateLimit)
    })

    it('takes the SHA from the date lookup when the listing has none', async () => {
      let client = createMockClient({
        getTagInfo: vi.fn().mockResolvedValue({
          sha: RESOLVED_SHA,
          date: oldEnough(),
          tag: 'v0.6.2',
          message: null,
        }),
        getAllTags: vi.fn().mockResolvedValue([makeTag('v0.6.2', null)]),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v0.6.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'major',
        now: NOW,
      })

      expect(result).toStrictEqual({
        update: {
          publishedAt: oldEnough(),
          sha: RESOLVED_SHA,
          version: 'v0.6.2',
        },
        reason: null,
      })
      expect(client.getTagSha).not.toHaveBeenCalled()
    })

    it('honours the mode while stepping down for the cool-down', async () => {
      let client = createMockClient({
        getAllTags: vi
          .fn()
          .mockResolvedValue([
            makeTag('v2.0.0', NEWEST_SHA),
            makeTag('v1.3.0', MIDDLE_SHA),
            makeTag('v1.2.5', OLDEST_SHA),
          ]),
        getTagInfo: tagInfoByDate({
          'v2.0.0': oldEnough(),
          'v1.2.5': oldEnough(),
          'v1.3.0': tooYoung(),
        }),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.2.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'minor',
        now: NOW,
      })

      expect(result).toStrictEqual({
        update: {
          publishedAt: oldEnough(),
          version: 'v1.2.5',
          sha: OLDEST_SHA,
        },
        reason: null,
      })
    })
  })

  describe('current behavior pending owner decision', () => {
    it('treats a date lookup that failed without a rate limit as old enough', async () => {
      let client = createMockClient({
        getAllTags: vi.fn().mockResolvedValue([makeTag('v0.6.3', NEWEST_SHA)]),
        getTagInfo: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      })

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v0.6.0',
        minAgeMs: COOL_DOWN_MS,
        mode: 'major',
        now: NOW,
      })

      expect(result).toStrictEqual({
        update: { publishedAt: null, version: 'v0.6.3', sha: NEWEST_SHA },
        reason: null,
      })
    })

    it('offers the tag without a SHA and remembers the gap when the SHA lookup is rate limited', async () => {
      let client = createMockClient({
        getTagSha: vi
          .fn()
          .mockRejectedValue(
            new GitHubRateLimitError(new Date('2026-09-04T01:00:00.000Z')),
          ),
        getAllTags: vi.fn().mockResolvedValue([makeTag('v4.2.4', null)]),
      })
      let parameters = {
        shaCache: new Map<string, string | null>(),
        actionName: 'actions/checkout',
        currentVersion: 'v4.2.0',
        mode: 'patch' as const,
      }

      let first = await getCompatibleUpdate(client, parameters)
      let second = await getCompatibleUpdate(client, parameters)

      expect([first, second]).toStrictEqual([
        {
          update: { publishedAt: null, version: 'v4.2.4', sha: null },
          reason: null,
        },
        {
          update: { publishedAt: null, version: 'v4.2.4', sha: null },
          reason: null,
        },
      ])
      expect(client.getTagSha).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        'v4.2.4',
      )
    })
  })
})
