import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeTagListingEntry,
  rateLimited,
  routeFetch,
  ok,
} from '../../helpers/route-fetch'
import { createClientContext } from '../../helpers/create-client-context'
import { getAllTags } from '../../../core/api/get-all-tags'

const TAGS_PATH = '/repos/actions/checkout/tags?per_page=100'

const NEWEST_SHA = 'd7a844d2069b33fe3788301b8c8e3cd1fc33e010'

const OLDER_SHA = '653a4b40d6895c83b35eb039402fe807f96c8a2c'

describe('getAllTags', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the tags with the commits they point at and no metadata', async () => {
    routeFetch({
      [TAGS_PATH]: ok([
        makeTagListingEntry('v4.2.2', NEWEST_SHA),
        makeTagListingEntry('v4.2.1', OLDER_SHA),
      ]),
    })

    let tags = await getAllTags(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 100,
    })

    expect(tags).toStrictEqual([
      { sha: NEWEST_SHA, message: null, tag: 'v4.2.2', date: null },
      { sha: OLDER_SHA, message: null, tag: 'v4.2.1', date: null },
    ])
  })

  it('requests as many tags as the limit asks for', async () => {
    let api = routeFetch({ '/repos/actions/checkout/tags?per_page=50': ok([]) })

    await getAllTags(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      limit: 50,
    })

    expect(api.paths).toStrictEqual([
      '/repos/actions/checkout/tags?per_page=50',
    ])
  })

  describe('current behavior pending owner decision', () => {
    it('rejects a rate-limited listing with the plain request error instead of GitHubRateLimitError', async () => {
      routeFetch({ [TAGS_PATH]: rateLimited() })

      let request = getAllTags(createClientContext(), {
        owner: 'actions',
        repo: 'checkout',
        limit: 100,
      })

      await expect(request).rejects.toStrictEqual(
        Object.assign(new Error('API rate limit exceeded'), { status: 403 }),
      )
    })
  })
})
