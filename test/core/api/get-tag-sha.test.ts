import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReferencePayload } from '../../helpers/route-fetch'

import {
  makeTagObjectPayload,
  makeReferencePayload,
  networkFailure,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'
import { getTagSha } from '../../../core/api/get-tag-sha'

const COMMIT_SHA = '1d3bb3940b11fb19062da85539933c53a7bc9f1f'

const TAG_OBJECT_SHA = '057b2c5fe322260608f0764aa0674139c14d3b65'

const TREE_SHA = '59dd04d1d9d3144493ba5762a3180eb7f225020c'

/**
 * Commit of the tag `channel`, which a request for `channel#v2.0.0` would reach
 * if the name were sent as it is.
 */
const CHANNEL_SHA = 'a81bbbf8298c0fa03ea29cdc473d45769f953675'

const CHANNEL_REFERENCE_PATH =
  '/repos/actions/checkout/git/ref/tags/channel%23v2.0.0'

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

  it('reads a tag by its percent-encoded name, never the tag that a name holding `#` starts with', async () => {
    routeFetch({
      '/repos/actions/checkout/git/ref/tags/channel': ok(
        makeReferencePayload('refs/tags/channel', {
          sha: CHANNEL_SHA,
          type: 'commit',
        }),
      ),
      [CHANNEL_REFERENCE_PATH]: ok(
        makeReferencePayload('refs/tags/channel#v2.0.0', {
          sha: COMMIT_SHA,
          type: 'commit',
        }),
      ),
    })

    let sha = await getTagSha(createClientContext(), {
      tag: 'channel#v2.0.0',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(sha).toBe(COMMIT_SHA)
  })

  it('reports the reference of another tag instead of taking its commit for the requested tag', async () => {
    routeFetch({
      [CHANNEL_REFERENCE_PATH]: ok(
        makeReferencePayload('refs/tags/channel', {
          sha: CHANNEL_SHA,
          type: 'commit',
        }),
      ),
    })

    let lookup = getTagSha(createClientContext(), {
      tag: 'channel#v2.0.0',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(lookup).rejects.toThrow(
      'GitHub answered for tag channel#v2.0.0 with the reference refs/tags/channel',
    )
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

  it('reports a failed tag object lookup instead of answering with the tag object SHA', async () => {
    routeFetch({
      [REFERENCE_PATH]: ok(annotatedReference()),
      [TAG_OBJECT_PATH]: serverError(),
    })

    let lookup = getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    await expect(lookup).rejects.toHaveProperty('status', 500)
  })

  it('returns null for an annotated tag whose tag object points at another tag', async () => {
    routeFetch({
      [TAG_OBJECT_PATH]: ok({
        ...makeTagObjectPayload({ sha: TAG_OBJECT_SHA }),
        object: { sha: TREE_SHA, type: 'tag' },
      }),
      [REFERENCE_PATH]: ok(annotatedReference()),
    })

    let sha = await getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(sha).toBeNull()
  })

  it('throws GitHubRateLimitError when the tag object lookup is rate limited', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    let api = routeFetch({
      [REFERENCE_PATH]: ok(annotatedReference()),
      [TAG_OBJECT_PATH]: rateLimited(resetAt),
    })
    let context = createClientContext()
    let parameters = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

    await expect(getTagSha(context, parameters)).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
    await expect(getTagSha(context, parameters)).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
    expect(api.paths).toStrictEqual([REFERENCE_PATH, TAG_OBJECT_PATH])
  })

  it('returns null when the tag object of an annotated tag is missing', async () => {
    routeFetch({
      [REFERENCE_PATH]: ok(annotatedReference()),
      [TAG_OBJECT_PATH]: notFound(),
    })

    let sha = await getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(sha).toBeNull()
  })

  it('reports a request that got no response', async () => {
    routeFetch({ [REFERENCE_PATH]: networkFailure() })

    let lookup = getTagSha(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    await expect(lookup).rejects.toBeInstanceOf(TypeError)
  })

  it('reports a lookup that failed for a reason other than a rate limit, and asks again later', async () => {
    let api = routeFetch({ [REFERENCE_PATH]: serverError() })
    let context = createClientContext()
    let parameters = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

    await expect(getTagSha(context, parameters)).rejects.toHaveProperty(
      'status',
      500,
    )
    await expect(getTagSha(context, parameters)).rejects.toHaveProperty(
      'status',
      500,
    )

    expect(api.paths).toStrictEqual([REFERENCE_PATH, REFERENCE_PATH])
  })
})
