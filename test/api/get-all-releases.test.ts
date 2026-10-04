/* eslint-disable camelcase */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeReleasePayload,
  serverError,
  rateLimited,
  routeFetch,
  ok,
} from '../helpers/route-fetch'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { createClientContext } from '../helpers/create-client-context'
import { getAllReleases } from '../../core/api/get-all-releases'

const RELEASES_PATH = '/repos/actions/checkout/releases?per_page=2'

const NEWEST_TARGET_SHA = '7388458f5c9f5d14097c482249ee089cc03e3f5a'

const OLDER_TARGET_SHA = 'df32723e55ab08728ae9f5484c6cc987858d6581'

describe('getAllReleases', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the releases normalized, with the commit SHA of the newest one only', async () => {
    routeFetch({
      [RELEASES_PATH]: ok([
        makeReleasePayload({
          html_url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
          published_at: '2024-10-23T14:46:00Z',
          target_commitish: NEWEST_TARGET_SHA,
          body: '* Fix checkout of tags',
          tag_name: 'v4.2.2',
          prerelease: false,
          name: 'v4.2.2',
        }),
        makeReleasePayload({
          html_url: 'https://github.com/actions/checkout/releases/tag/v4.2.1',
          published_at: '2024-10-07T08:12:00Z',
          target_commitish: OLDER_TARGET_SHA,
          tag_name: 'v4.2.1',
          prerelease: false,
          body: null,
          name: null,
        }),
      ]),
    })

    let releases = await getAllReleases(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 2,
    })

    expect(releases).toStrictEqual([
      {
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
        publishedAt: new Date('2024-10-23T14:46:00Z'),
        description: '* Fix checkout of tags',
        sha: NEWEST_TARGET_SHA,
        isPrerelease: false,
        version: 'v4.2.2',
        name: 'v4.2.2',
      },
      {
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.1',
        publishedAt: new Date('2024-10-07T08:12:00Z'),
        isPrerelease: false,
        description: null,
        version: 'v4.2.1',
        name: 'v4.2.1',
        sha: null,
      },
    ])
  })

  it('does not mistake a v-prefixed, digit-only target of the newest release for a commit SHA', async () => {
    routeFetch({
      [RELEASES_PATH]: ok([
        makeReleasePayload({ target_commitish: 'v20240101' }),
      ]),
    })

    let releases = await getAllReleases(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 2,
    })

    expect(releases[0]?.sha).toBeNull()
  })

  it('requests as many releases as the limit asks for', async () => {
    let api = routeFetch({
      '/repos/actions/checkout/releases?per_page=25': ok([]),
    })

    await getAllReleases(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 25,
    })

    expect(api.paths).toStrictEqual([
      '/repos/actions/checkout/releases?per_page=25',
    ])
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [RELEASES_PATH]: rateLimited(resetAt) })

    let request = getAllReleases(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 2,
    })

    await expect(request).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })

  it('propagates any other failure', async () => {
    routeFetch({ [RELEASES_PATH]: serverError() })

    let request = getAllReleases(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 2,
    })

    await expect(request).rejects.toHaveProperty('status', 500)
  })
})

/* eslint-enable camelcase */
