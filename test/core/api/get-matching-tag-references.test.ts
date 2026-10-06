import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeReferencePayload,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { getMatchingTagReferences } from '../../../core/api/get-matching-tag-references'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'

const ACTIONS_FAMILY_PATH =
  '/repos/actions/checkout/git/matching-refs/tags/actions-'

const CLI_FAMILY_PATH = '/repos/actions/checkout/git/matching-refs/tags/cli-'

const OLDER_SHA = '41d32f03d2117279f74ab0cd07a5bd4a65a71054'

const NEWER_SHA = '9d2d34b8001767372d5eb17b0519c9c06f733624'

const TAG_OBJECT_SHA = '4ef8d745bf4e3c5ca37df501f0e66010fc5923db'

describe('getMatchingTagReferences', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the tags matching the prefix, without the refs/tags prefix', async () => {
    routeFetch({
      [ACTIONS_FAMILY_PATH]: ok([
        makeReferencePayload('refs/tags/actions-v0.1.1', {
          type: 'commit',
          sha: OLDER_SHA,
        }),
        makeReferencePayload('refs/tags/actions-v0.1.2', {
          type: 'commit',
          sha: NEWER_SHA,
        }),
      ]),
    })

    let tags = await getMatchingTagReferences(createClientContext(), {
      prefix: 'actions-',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(tags).toStrictEqual([
      { tag: 'actions-v0.1.1', sha: OLDER_SHA, message: null, date: null },
      { tag: 'actions-v0.1.2', sha: NEWER_SHA, message: null, date: null },
    ])
  })

  it('leaves the SHA unknown for an annotated tag', async () => {
    routeFetch({
      [ACTIONS_FAMILY_PATH]: ok([
        makeReferencePayload('refs/tags/actions-v0.2.0', {
          sha: TAG_OBJECT_SHA,
          type: 'tag',
        }),
      ]),
    })

    let tags = await getMatchingTagReferences(createClientContext(), {
      prefix: 'actions-',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(tags).toStrictEqual([
      { tag: 'actions-v0.2.0', message: null, date: null, sha: null },
    ])
  })

  it('returns an empty list when no tag matches', async () => {
    routeFetch({ [ACTIONS_FAMILY_PATH]: ok([]) })

    let tags = await getMatchingTagReferences(createClientContext(), {
      prefix: 'actions-',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(tags).toStrictEqual([])
  })

  it('answers a repeated lookup of a prefix from the cache', async () => {
    let api = routeFetch({
      [ACTIONS_FAMILY_PATH]: ok([
        makeReferencePayload('refs/tags/actions-v0.1.2', {
          type: 'commit',
          sha: NEWER_SHA,
        }),
      ]),
    })
    let context = createClientContext()
    let parameters = { prefix: 'actions-', owner: 'actions', repo: 'checkout' }

    let first = await getMatchingTagReferences(context, parameters)
    let second = await getMatchingTagReferences(context, parameters)

    expect(second).toStrictEqual(first)
    expect(api.paths).toStrictEqual([ACTIONS_FAMILY_PATH])
  })

  it('keeps the cached tags of different prefixes apart', async () => {
    let api = routeFetch({
      [ACTIONS_FAMILY_PATH]: ok([
        makeReferencePayload('refs/tags/actions-v0.1.2', {
          type: 'commit',
          sha: NEWER_SHA,
        }),
      ]),
      [CLI_FAMILY_PATH]: ok([
        makeReferencePayload('refs/tags/cli-v2.0.0', {
          type: 'commit',
          sha: OLDER_SHA,
        }),
      ]),
    })
    let context = createClientContext()

    let actionsFamily = await getMatchingTagReferences(context, {
      prefix: 'actions-',
      owner: 'actions',
      repo: 'checkout',
    })
    let cliFamily = await getMatchingTagReferences(context, {
      owner: 'actions',
      repo: 'checkout',
      prefix: 'cli-',
    })

    expect([actionsFamily, cliFamily]).toStrictEqual([
      [{ tag: 'actions-v0.1.2', sha: NEWER_SHA, message: null, date: null }],
      [{ tag: 'cli-v2.0.0', sha: OLDER_SHA, message: null, date: null }],
    ])
    expect(api.paths).toStrictEqual([ACTIONS_FAMILY_PATH, CLI_FAMILY_PATH])
  })

  it('treats a repository it cannot see as having no matching tags, without asking again', async () => {
    let api = routeFetch({ [ACTIONS_FAMILY_PATH]: notFound() })
    let context = createClientContext()
    let parameters = { prefix: 'actions-', owner: 'actions', repo: 'checkout' }

    let first = await getMatchingTagReferences(context, parameters)
    let second = await getMatchingTagReferences(context, parameters)

    expect([first, second]).toStrictEqual([[], []])
    expect(api.paths).toStrictEqual([ACTIONS_FAMILY_PATH])
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [ACTIONS_FAMILY_PATH]: rateLimited(resetAt) })

    let request = getMatchingTagReferences(createClientContext(), {
      prefix: 'actions-',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(request).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
