/* eslint-disable camelcase */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeReleasePayload,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'
import { getLatestRelease } from '../../../core/api/get-latest-release'

const LATEST_RELEASE_PATH = '/repos/actions/checkout/releases/latest'

const TARGET_SHA = 'fd80a2579f6f99b3a14cf53cf5a4026c866e73a5'

describe('getLatestRelease', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the latest release normalized, with the commit SHA it was cut from', async () => {
    routeFetch({
      [LATEST_RELEASE_PATH]: ok(
        makeReleasePayload({
          html_url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
          body: '## Changes\n* Fix checkout of annotated tags',
          published_at: '2024-10-23T14:46:00Z',
          target_commitish: TARGET_SHA,
          name: 'Release v4.2.2',
          tag_name: 'v4.2.2',
          prerelease: false,
        }),
      ),
    })

    let release = await getLatestRelease(
      createClientContext(),
      'actions',
      'checkout',
    )

    expect(release).toStrictEqual({
      url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
      description: '## Changes\n* Fix checkout of annotated tags',
      publishedAt: new Date('2024-10-23T14:46:00Z'),
      name: 'Release v4.2.2',
      isPrerelease: false,
      version: 'v4.2.2',
      sha: TARGET_SHA,
    })
  })

  it('does not mistake a v-prefixed, digit-only release target for a commit SHA', async () => {
    routeFetch({
      [LATEST_RELEASE_PATH]: ok(
        makeReleasePayload({ target_commitish: 'v20240101' }),
      ),
    })

    let release = await getLatestRelease(
      createClientContext(),
      'actions',
      'checkout',
    )

    expect(release?.sha).toBeNull()
  })

  it('returns null when the repository has no latest release', async () => {
    routeFetch({ [LATEST_RELEASE_PATH]: notFound() })

    let release = await getLatestRelease(
      createClientContext(),
      'actions',
      'checkout',
    )

    expect(release).toBeNull()
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [LATEST_RELEASE_PATH]: rateLimited(resetAt) })

    let request = getLatestRelease(createClientContext(), 'actions', 'checkout')

    await expect(request).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })

  it('propagates any other failure', async () => {
    routeFetch({ [LATEST_RELEASE_PATH]: serverError() })

    let request = getLatestRelease(createClientContext(), 'actions', 'checkout')

    await expect(request).rejects.toHaveProperty('status', 500)
  })
})

/* eslint-enable camelcase */
