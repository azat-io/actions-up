import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeTagRelease,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'
import { getReleaseByTag } from '../../../core/api/get-release-by-tag'

const RELEASE_PATH = '/repos/actions/checkout/releases/tags/v4.2.2'

const PARAMETERS = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

/**
 * Release path of `channel#v2.0.0`, whose `#` would start the fragment of a URL
 * if it were sent as it is.
 */
const CHANNEL_RELEASE_PATH =
  '/repos/actions/checkout/releases/tags/channel%23v2.0.0'

describe('getReleaseByTag', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the published release of the tag, normalized', async () => {
    routeFetch({
      [RELEASE_PATH]: ok(makeTagRelease('v4.2.2', '2024-10-23T14:46:00Z')),
    })

    let release = await getReleaseByTag(createClientContext(), PARAMETERS)

    expect(release).toStrictEqual({
      description:
        "## What's Changed\n* Check out the default branch of submodules",
      url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
      publishedAt: new Date('2024-10-23T14:46:00Z'),
      isPrerelease: false,
      version: 'v4.2.2',
      immutable: false,
      name: 'v4.2.2',
    })
  })

  it('reports an immutable release', async () => {
    routeFetch({
      [RELEASE_PATH]: ok(
        makeTagRelease('v4.2.2', '2024-10-23T14:46:00Z', { immutable: true }),
      ),
    })

    let release = await getReleaseByTag(createClientContext(), PARAMETERS)

    expect(release?.immutable).toBe(true)
  })

  it('asks for a tag by its percent-encoded name', async () => {
    routeFetch({
      '/repos/actions/checkout/releases/tags/release%2Fv4.2.2': ok(
        makeTagRelease('release/v4.2.2', '2024-10-23T14:46:00Z'),
      ),
    })

    let release = await getReleaseByTag(createClientContext(), {
      ...PARAMETERS,
      tag: 'release/v4.2.2',
    })

    expect(release?.version).toBe('release/v4.2.2')
  })

  it('never asks for the release of the tag that a name holding `#` starts with', async () => {
    routeFetch({
      '/repos/actions/checkout/releases/tags/channel': ok(
        makeTagRelease('channel', '2024-10-23T14:46:00Z', { immutable: true }),
      ),
      [CHANNEL_RELEASE_PATH]: notFound(),
    })

    let release = await getReleaseByTag(createClientContext(), {
      ...PARAMETERS,
      tag: 'channel#v2.0.0',
    })

    expect(release).toBeNull()
  })

  it('reports a release of another tag instead of taking it for the requested one', async () => {
    routeFetch({
      [CHANNEL_RELEASE_PATH]: ok(
        makeTagRelease('channel', '2024-10-23T14:46:00Z', { immutable: true }),
      ),
    })

    let lookup = getReleaseByTag(createClientContext(), {
      ...PARAMETERS,
      tag: 'channel#v2.0.0',
    })

    await expect(lookup).rejects.toThrow(
      'GitHub answered for tag channel#v2.0.0 with the release of channel',
    )
  })

  it('answers null for a tag without a published release', async () => {
    routeFetch({ [RELEASE_PATH]: notFound() })

    let release = await getReleaseByTag(createClientContext(), PARAMETERS)

    expect(release).toBeNull()
  })

  it('reports any other failure instead of passing for a tag without a release', async () => {
    routeFetch({ [RELEASE_PATH]: serverError() })

    let lookup = getReleaseByTag(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toHaveProperty('status', 500)
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [RELEASE_PATH]: rateLimited(resetAt) })

    let lookup = getReleaseByTag(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
