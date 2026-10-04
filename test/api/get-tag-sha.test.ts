import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReferencePayload } from '../helpers/route-fetch'

import {
  makeTagObjectPayload,
  makeReferencePayload,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../helpers/route-fetch'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { createClientContext } from '../helpers/create-client-context'
import { getTagSha } from '../../core/api/get-tag-sha'

const COMMIT_SHA = '1d3bb3940b11fb19062da85539933c53a7bc9f1f'

const TAG_OBJECT_SHA = '057b2c5fe322260608f0764aa0674139c14d3b65'

const TREE_SHA = '59dd04d1d9d3144493ba5762a3180eb7f225020c'

const REFERENCE_PATH = '/repos/actions/checkout/git/ref/tags/v4.2.2'

const TAG_OBJECT_PATH = `/repos/actions/checkout/git/tags/${TAG_OBJECT_SHA}`

/**
 * Reference of the lightweight tag `v4.2.2`, pointing at the commit.
 *
 * @returns Fresh reference payload.
 */
function lightweightReference(): ReferencePayload {
  return makeReferencePayload('refs/tags/v4.2.2', {
    sha: COMMIT_SHA,
    type: 'commit',
  })
}

/**
 * Reference of the annotated tag `v4.2.2`, pointing at its tag object.
 *
 * @returns Fresh reference payload.
 */
function annotatedReference(): ReferencePayload {
  return makeReferencePayload('refs/tags/v4.2.2', {
    sha: TAG_OBJECT_SHA,
    type: 'tag',
  })
}

describe('getTagSha', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves an annotated tag to the commit its tag object points at', async () => {
    routeFetch({
      [TAG_OBJECT_PATH]: ok(
        makeTagObjectPayload({
          object: { sha: COMMIT_SHA, type: 'commit' },
          sha: TAG_OBJECT_SHA,
        }),
      ),
      [REFERENCE_PATH]: ok(annotatedReference()),
    })

    let sha = await getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(sha).toBe(COMMIT_SHA)
  })

  it('resolves a lightweight tag to its commit with a single request', async () => {
    let api = routeFetch({ [REFERENCE_PATH]: ok(lightweightReference()) })

    let sha = await getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(sha).toBe(COMMIT_SHA)
    expect(api.paths).toStrictEqual([REFERENCE_PATH])
  })

  it('accepts a fully qualified tag reference', async () => {
    routeFetch({ [REFERENCE_PATH]: ok(lightweightReference()) })

    let sha = await getTagSha(createClientContext(), {
      tag: 'refs/tags/v4.2.2',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(sha).toBe(COMMIT_SHA)
  })

  it('returns null for a tag that exists only as a prefix of other tags', async () => {
    routeFetch({
      '/repos/actions/checkout/git/matching-refs/tags/v8': ok([
        makeReferencePayload('refs/tags/v8.3.2', {
          sha: COMMIT_SHA,
          type: 'commit',
        }),
      ]),
      '/repos/actions/checkout/git/ref/tags/v8': notFound(),
    })

    let sha = await getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v8',
    })

    expect(sha).toBeNull()
  })

  it('remembers a resolved tag for repeated lookups', async () => {
    let api = routeFetch({ [REFERENCE_PATH]: ok(lightweightReference()) })
    let context = createClientContext()
    let parameters = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

    let first = await getTagSha(context, parameters)
    let second = await getTagSha(context, parameters)

    expect([first, second]).toStrictEqual([COMMIT_SHA, COMMIT_SHA])
    expect(api.paths).toStrictEqual([REFERENCE_PATH])
  })

  it('remembers a missing tag for repeated lookups', async () => {
    let api = routeFetch({ [REFERENCE_PATH]: notFound() })
    let context = createClientContext()
    let parameters = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

    let first = await getTagSha(context, parameters)
    let second = await getTagSha(context, parameters)

    expect([first, second]).toStrictEqual([null, null])
    expect(api.paths).toStrictEqual([REFERENCE_PATH])
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [REFERENCE_PATH]: rateLimited(resetAt) })

    let lookup = getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })

  it('returns null for a tag that points at a tree instead of a commit', async () => {
    routeFetch({
      [REFERENCE_PATH]: ok(
        makeReferencePayload('refs/tags/v4.2.2', {
          sha: TREE_SHA,
          type: 'tree',
        }),
      ),
    })

    let sha = await getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(sha).toBeNull()
  })

  describe('current behavior pending owner decision', () => {
    it('returns the tag object SHA instead of a commit SHA when the tag object lookup fails', async () => {
      routeFetch({
        [REFERENCE_PATH]: ok(annotatedReference()),
        [TAG_OBJECT_PATH]: serverError(),
      })

      let sha = await getTagSha(createClientContext(), {
        owner: 'actions',
        repo: 'checkout',
        tag: 'v4.2.2',
      })

      expect(sha).toBe(TAG_OBJECT_SHA)
    })

    it('remembers a lookup that failed for a reason other than a rate limit as a missing tag', async () => {
      let api = routeFetch({ [REFERENCE_PATH]: serverError() })
      let context = createClientContext()
      let parameters = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

      let first = await getTagSha(context, parameters)
      let second = await getTagSha(context, parameters)

      expect([first, second]).toStrictEqual([null, null])
      expect(api.paths).toStrictEqual([REFERENCE_PATH])
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it.each(['commit', 'tag'] as const)(
      'returns null when the reference to a %s carries an empty SHA',
      async type => {
        routeFetch({
          [REFERENCE_PATH]: ok(
            makeReferencePayload('refs/tags/v4.2.2', { sha: '', type }),
          ),
        })

        let sha = await getTagSha(createClientContext(), {
          owner: 'actions',
          repo: 'checkout',
          tag: 'v4.2.2',
        })

        expect(sha).toBeNull()
      },
    )

    it('returns null when the tag object names no target', async () => {
      routeFetch({
        [TAG_OBJECT_PATH]: ok(
          makeTagObjectPayload({
            object: { type: 'commit', sha: null },
            sha: TAG_OBJECT_SHA,
          }),
        ),
        [REFERENCE_PATH]: ok(annotatedReference()),
      })

      let sha = await getTagSha(createClientContext(), {
        owner: 'actions',
        repo: 'checkout',
        tag: 'v4.2.2',
      })

      expect(sha).toBeNull()
    })
  })
})
