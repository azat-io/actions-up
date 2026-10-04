/* eslint-disable camelcase */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  TagObjectPayload,
  ReleasePayload,
  CommitPayload,
  RouteAnswer,
} from '../helpers/route-fetch'
import type { TagInfo } from '../../types/tag-info'

import {
  makeTagObjectPayload,
  makeReferencePayload,
  makeReleasePayload,
  makeCommitPayload,
  networkFailure,
  serverError,
  rateLimited,
  routeFetch,
  forbidden,
  notFound,
  ok,
} from '../helpers/route-fetch'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { createClientContext } from '../helpers/create-client-context'
import { getTagInfo } from '../../core/api/get-tag-info'

const TAG = 'v4.2.2'

const LOOKUP = { owner: 'actions', repo: 'checkout', tag: TAG }

const COMMIT_SHA = '59dd04d1d9d3144493ba5762a3180eb7f225020c'

const TAG_OBJECT_SHA = 'cd82d3b1be3c16c89a1ec4ca4c7ba189e84866f1'

const RELEASE_TARGET_SHA = 'f99ec2c51ef18286560386f0726d216a4f4909b0'

const TREE_SHA = '1d3bb3940b11fb19062da85539933c53a7bc9f1f'

const RELEASE_PATH = '/repos/actions/checkout/releases/tags/v4.2.2'

const REFERENCE_PATH = '/repos/actions/checkout/git/ref/tags/v4.2.2'

const TAG_OBJECT_PATH = `/repos/actions/checkout/git/tags/${TAG_OBJECT_SHA}`

const COMMIT_PATH = `/repos/actions/checkout/git/commits/${COMMIT_SHA}`

const RELEASE_DATE = '2024-10-23T14:46:00Z'

const TAGGER_DATE = '2024-10-23T14:40:00Z'

const COMMIT_DATE = '2024-10-22T09:15:00Z'

const RELEASE_NOTES = '## Changes\n* Fix checkout of annotated tags'

const TAG_MESSAGE = 'Release v4.2.2\n'

const COMMIT_MESSAGE = 'Prepare release v4.2.2'

const RESET_AT = new Date('2026-10-03T14:37:21.000Z')

/**
 * Routes of an annotated tag whose tag object points at the commit.
 *
 * @param tagObject - Tag object fields to replace.
 * @returns Routes answering the reference and tag object lookups.
 */
function annotatedTag(
  tagObject: Partial<TagObjectPayload> = {},
): Record<string, RouteAnswer> {
  return {
    [TAG_OBJECT_PATH]: ok(
      makeTagObjectPayload({
        object: { sha: COMMIT_SHA, type: 'commit' },
        tagger: { date: TAGGER_DATE },
        message: TAG_MESSAGE,
        sha: TAG_OBJECT_SHA,
        tag: TAG,
        ...tagObject,
      }),
    ),
    [REFERENCE_PATH]: ok(
      makeReferencePayload(`refs/tags/${TAG}`, {
        sha: TAG_OBJECT_SHA,
        type: 'tag',
      }),
    ),
  }
}

/**
 * Routes of a lightweight tag that points straight at the commit.
 *
 * @param commit - Commit fields to replace.
 * @returns Routes answering the reference and commit lookups.
 */
function lightweightTag(
  commit: Partial<CommitPayload> = {},
): Record<string, RouteAnswer> {
  return {
    [COMMIT_PATH]: ok(
      makeCommitPayload({
        author: { date: COMMIT_DATE },
        message: COMMIT_MESSAGE,
        sha: COMMIT_SHA,
        ...commit,
      }),
    ),
    [REFERENCE_PATH]: ok(
      makeReferencePayload(`refs/tags/${TAG}`, {
        sha: COMMIT_SHA,
        type: 'commit',
      }),
    ),
  }
}

/**
 * Route of a release published for the tag, with a date and notes unless
 * overridden.
 *
 * @param overrides - Release fields to replace.
 * @returns Routes answering the release lookup.
 */
function release(
  overrides: Partial<ReleasePayload> = {},
): Record<string, RouteAnswer> {
  return {
    [RELEASE_PATH]: ok(
      makeReleasePayload({
        published_at: RELEASE_DATE,
        body: RELEASE_NOTES,
        tag_name: TAG,
        ...overrides,
      }),
    ),
  }
}

/**
 * Route of a tag that has no release.
 *
 * @returns Routes answering the release lookup with a 404.
 */
function noRelease(): Record<string, RouteAnswer> {
  return { [RELEASE_PATH]: notFound() }
}

describe('getTagInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('for a tag with a release', () => {
    it('takes the date and notes from the release and the SHA from the commit of an annotated tag', async () => {
      routeFetch({ ...release(), ...annotatedTag() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('fills a missing release date and notes from the annotated tag', async () => {
      routeFetch({
        ...release({ published_at: null, body: null }),
        ...annotatedTag(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(TAGGER_DATE),
        message: TAG_MESSAGE,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('fills a missing release date and notes from the commit of a lightweight tag', async () => {
      routeFetch({
        ...release({ published_at: null, body: null }),
        ...lightweightTag(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(COMMIT_DATE),
        message: COMMIT_MESSAGE,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('fills only the missing release date from the commit', async () => {
      routeFetch({ ...release({ published_at: null }), ...lightweightTag() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(COMMIT_DATE),
        message: RELEASE_NOTES,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('fills only the missing release notes from the commit', async () => {
      routeFetch({ ...release({ body: null }), ...lightweightTag() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: COMMIT_MESSAGE,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('skips the commit lookup when the release has both a date and notes', async () => {
      let api = routeFetch({ ...release(), ...lightweightTag() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: COMMIT_SHA,
        tag: TAG,
      })
      expect(api.paths).toStrictEqual([RELEASE_PATH, REFERENCE_PATH])
    })

    it('keeps the release date and the tag commit when the commit lookup for the missing notes fails', async () => {
      routeFetch({
        ...release({ target_commitish: RELEASE_TARGET_SHA, body: null }),
        ...lightweightTag(),
        [COMMIT_PATH]: serverError(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        sha: COMMIT_SHA,
        message: null,
        tag: TAG,
      })
    })

    it('takes the SHA from the release target when the reference lookup fails', async () => {
      routeFetch({
        ...release({ target_commitish: RELEASE_TARGET_SHA }),
        [REFERENCE_PATH]: notFound(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        sha: RELEASE_TARGET_SHA,
        message: RELEASE_NOTES,
        tag: TAG,
      })
    })

    it('does not mistake a v-prefixed, digit-only release target for a commit SHA when the reference lookup fails', async () => {
      routeFetch({
        ...release({ target_commitish: 'v20240101' }),
        [REFERENCE_PATH]: notFound(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: null,
        tag: TAG,
      })
    })

    it('accepts a fully qualified tag reference', async () => {
      routeFetch({ ...release(), ...lightweightTag() })

      let info = await getTagInfo(createClientContext(), {
        ...LOOKUP,
        tag: `refs/tags/${TAG}`,
      })

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('leaves the SHA unknown for a tag that points at a tree', async () => {
      routeFetch({
        ...release(),
        [REFERENCE_PATH]: ok(
          makeReferencePayload(`refs/tags/${TAG}`, {
            sha: TREE_SHA,
            type: 'tree',
          }),
        ),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: null,
        tag: TAG,
      })
    })
  })

  describe('for a tag without a release', () => {
    it('reads the date and message of an annotated tag from its tag object', async () => {
      routeFetch({ ...noRelease(), ...annotatedTag() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(TAGGER_DATE),
        message: TAG_MESSAGE,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('reads the date and message of a lightweight tag from its commit', async () => {
      routeFetch({ ...noRelease(), ...lightweightTag() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(COMMIT_DATE),
        message: COMMIT_MESSAGE,
        sha: COMMIT_SHA,
        tag: TAG,
      })
    })

    it('keeps the SHA of a lightweight tag when its commit lookup fails', async () => {
      routeFetch({
        ...noRelease(),
        ...lightweightTag(),
        [COMMIT_PATH]: serverError(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        sha: COMMIT_SHA,
        message: null,
        date: null,
        tag: TAG,
      })
    })

    it('returns null for a tag that does not exist', async () => {
      routeFetch({ ...noRelease(), [REFERENCE_PATH]: notFound() })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toBeNull()
    })
  })

  it('propagates lookups that got no response', async () => {
    routeFetch({
      [REFERENCE_PATH]: networkFailure(),
      [RELEASE_PATH]: networkFailure(),
    })

    let lookup = getTagInfo(createClientContext(), LOOKUP)

    await expect(lookup).rejects.toBeInstanceOf(TypeError)
  })

  it.each<{
    routes: Record<string, RouteAnswer>
    expected: TagInfo | null
    description: string
  }>([
    {
      expected: {
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: COMMIT_SHA,
        tag: TAG,
      },
      routes: { ...release(), ...lightweightTag() },
      description: 'a tag with a release',
    },
    {
      expected: {
        date: new Date(COMMIT_DATE),
        message: COMMIT_MESSAGE,
        sha: COMMIT_SHA,
        tag: TAG,
      },
      routes: { ...noRelease(), ...lightweightTag() },
      description: 'a tag without a release',
    },
    {
      routes: { ...noRelease(), [REFERENCE_PATH]: notFound() },
      description: 'a tag that does not exist',
      expected: null,
    },
  ])(
    'remembers $description for repeated lookups',
    async ({ expected, routes }) => {
      let api = routeFetch(routes)
      let context = createClientContext()

      let first = await getTagInfo(context, LOOKUP)
      let requestsForFirstLookup = api.paths.length
      let second = await getTagInfo(context, LOOKUP)

      expect([first, second]).toStrictEqual([expected, expected])
      expect(api.paths).toHaveLength(requestsForFirstLookup)
    },
  )

  describe('rate limits', () => {
    it.each<{ routes: Record<string, RouteAnswer>; lookup: string }>([
      {
        routes: { [RELEASE_PATH]: rateLimited(RESET_AT) },
        lookup: 'the release lookup',
      },
      {
        routes: { ...release(), [REFERENCE_PATH]: rateLimited(RESET_AT) },
        lookup: 'the reference lookup after a release',
      },
      {
        routes: {
          ...release(),
          ...annotatedTag(),
          [TAG_OBJECT_PATH]: rateLimited(RESET_AT),
        },
        lookup: 'the tag object lookup after a release',
      },
      {
        routes: {
          ...release({ published_at: null, body: null }),
          ...lightweightTag(),
          [COMMIT_PATH]: rateLimited(RESET_AT),
        },
        lookup: 'the commit lookup after a release',
      },
      {
        routes: { ...noRelease(), [REFERENCE_PATH]: rateLimited(RESET_AT) },
        lookup: 'the reference lookup without a release',
      },
      {
        routes: {
          ...noRelease(),
          ...annotatedTag(),
          [TAG_OBJECT_PATH]: rateLimited(RESET_AT),
        },
        lookup: 'the tag object lookup without a release',
      },
      {
        routes: {
          ...noRelease(),
          ...lightweightTag(),
          [COMMIT_PATH]: rateLimited(RESET_AT),
        },
        lookup: 'the commit lookup without a release',
      },
    ])(
      'throws GitHubRateLimitError with the reset time when $lookup is rate limited',
      async ({ routes }) => {
        routeFetch(routes)

        let lookup = getTagInfo(createClientContext(), LOOKUP)

        await expect(lookup).rejects.toStrictEqual(
          new GitHubRateLimitError(RESET_AT),
        )
      },
    )

    it('stops at a rate-limited release lookup instead of falling back to the reference', async () => {
      let api = routeFetch({
        [REFERENCE_PATH]: rateLimited(),
        [RELEASE_PATH]: rateLimited(),
      })

      await expect(getTagInfo(createClientContext(), LOOKUP)).rejects.toThrow(
        GitHubRateLimitError,
      )

      expect(api.paths).toStrictEqual([RELEASE_PATH])
    })

    it('asks again after a rate-limited lookup', async () => {
      let api = routeFetch({ [RELEASE_PATH]: rateLimited() })
      let context = createClientContext()

      await expect(getTagInfo(context, LOOKUP)).rejects.toThrow(
        GitHubRateLimitError,
      )
      await expect(getTagInfo(context, LOOKUP)).rejects.toThrow(
        GitHubRateLimitError,
      )

      expect(api.paths).toStrictEqual([RELEASE_PATH, RELEASE_PATH])
    })
  })

  describe('current behavior pending owner decision', () => {
    it('returns the tag object SHA instead of a commit SHA when the tag object lookup after a release fails', async () => {
      routeFetch({
        ...release(),
        ...annotatedTag(),
        [TAG_OBJECT_PATH]: serverError(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: TAG_OBJECT_SHA,
        tag: TAG,
      })
    })

    it('returns the tag object SHA instead of a commit SHA when the tag object lookup without a release fails', async () => {
      routeFetch({
        ...noRelease(),
        ...annotatedTag(),
        [TAG_OBJECT_PATH]: serverError(),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        sha: TAG_OBJECT_SHA,
        message: null,
        date: null,
        tag: TAG,
      })
    })

    it('reads a refused reference lookup as a missing tag and remembers it', async () => {
      let api = routeFetch({
        [REFERENCE_PATH]: forbidden('Resource not accessible by integration'),
        ...noRelease(),
      })
      let context = createClientContext()

      let first = await getTagInfo(context, LOOKUP)
      let second = await getTagInfo(context, LOOKUP)

      expect([first, second]).toStrictEqual([null, null])
      expect(api.paths).toStrictEqual([RELEASE_PATH, REFERENCE_PATH])
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it.each(['commit', 'tag'] as const)(
      'leaves the SHA unknown when the reference to a %s carries an empty SHA',
      async type => {
        routeFetch({
          [REFERENCE_PATH]: ok(
            makeReferencePayload(`refs/tags/${TAG}`, { sha: '', type }),
          ),
          ...release(),
        })

        let info = await getTagInfo(createClientContext(), LOOKUP)

        expect(info).toStrictEqual({
          date: new Date(RELEASE_DATE),
          message: RELEASE_NOTES,
          sha: null,
          tag: TAG,
        })
      },
    )

    it('keeps the tag object SHA when the tag object of a released tag names no target', async () => {
      routeFetch({
        ...release(),
        ...annotatedTag({ object: { type: 'commit', sha: null } }),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        date: new Date(RELEASE_DATE),
        message: RELEASE_NOTES,
        sha: TAG_OBJECT_SHA,
        tag: TAG,
      })
    })

    it('reads a tag object without a target, message or date as the tag object SHA alone', async () => {
      routeFetch({
        ...noRelease(),
        ...annotatedTag({
          object: { type: 'commit', sha: null },
          tagger: { date: null },
          message: null,
        }),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        sha: TAG_OBJECT_SHA,
        message: null,
        date: null,
        tag: TAG,
      })
    })

    it('reads a commit without a message or author date as the commit SHA alone', async () => {
      routeFetch({
        ...noRelease(),
        ...lightweightTag({ author: { date: null }, message: null }),
      })

      let info = await getTagInfo(createClientContext(), LOOKUP)

      expect(info).toStrictEqual({
        sha: COMMIT_SHA,
        message: null,
        date: null,
        tag: TAG,
      })
    })
  })
})

/* eslint-enable camelcase */
