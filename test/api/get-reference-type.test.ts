import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReferencePayload, RouteAnswer } from '../helpers/route-fetch'

import {
  makeReferencePayload,
  networkFailure,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../helpers/route-fetch'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { createClientContext } from '../helpers/create-client-context'
import { getReferenceType } from '../../core/api/get-reference-type'

const COMMIT_SHA = '280cb41c35e846d8ce8e82b282e4e919d72d0663'

const TAG_PATH = '/repos/actions/checkout/git/ref/tags/v4'

const MAIN_AS_TAG_PATH = '/repos/actions/checkout/git/ref/tags/main'

const MAIN_AS_BRANCH_PATH = '/repos/actions/checkout/git/ref/heads/main'

/**
 * Reference of the branch `main`.
 *
 * @returns Fresh reference payload.
 */
function branchReference(): ReferencePayload {
  return makeReferencePayload('refs/heads/main', {
    sha: COMMIT_SHA,
    type: 'commit',
  })
}

/**
 * Reference of the tag `v4`.
 *
 * @returns Fresh reference payload.
 */
function tagReference(): ReferencePayload {
  return makeReferencePayload('refs/tags/v4', {
    sha: COMMIT_SHA,
    type: 'commit',
  })
}

describe('getReferenceType', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects a tag through the exact tag reference', async () => {
    routeFetch({ [TAG_PATH]: ok(tagReference()) })

    let type = await getReferenceType(createClientContext(), {
      owner: 'actions',
      repo: 'checkout',
      reference: 'v4',
    })

    expect(type).toBe('tag')
  })

  it('detects a branch when only the exact branch reference exists', async () => {
    routeFetch({
      [MAIN_AS_BRANCH_PATH]: ok(branchReference()),
      [MAIN_AS_TAG_PATH]: notFound(),
    })

    let type = await getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(type).toBe('branch')
  })

  it('returns null when neither a tag nor a branch has that exact name', async () => {
    routeFetch({
      [MAIN_AS_BRANCH_PATH]: notFound(),
      [MAIN_AS_TAG_PATH]: notFound(),
    })

    let type = await getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    expect(type).toBeNull()
  })

  it.each<{
    routes: Record<string, RouteAnswer>
    expected: 'branch' | 'tag' | null
    description: string
    reference: string
  }>([
    {
      routes: { [TAG_PATH]: ok(tagReference()) },
      description: 'a tag',
      reference: 'v4',
      expected: 'tag',
    },
    {
      routes: {
        [MAIN_AS_BRANCH_PATH]: ok(branchReference()),
        [MAIN_AS_TAG_PATH]: notFound(),
      },
      description: 'a branch',
      expected: 'branch',
      reference: 'main',
    },
    {
      routes: {
        [MAIN_AS_BRANCH_PATH]: notFound(),
        [MAIN_AS_TAG_PATH]: notFound(),
      },
      description: 'neither',
      reference: 'main',
      expected: null,
    },
  ])(
    'remembers that a reference is $description for repeated lookups',
    async ({ reference, expected, routes }) => {
      let api = routeFetch(routes)
      let context = createClientContext()
      let parameters = { owner: 'actions', repo: 'checkout', reference }

      let first = await getReferenceType(context, parameters)
      let requestsForFirstLookup = api.paths.length
      let second = await getReferenceType(context, parameters)

      expect([first, second]).toStrictEqual([expected, expected])
      expect(api.paths).toHaveLength(requestsForFirstLookup)
    },
  )

  it('reports a failed tag lookup instead of reading it as neither', async () => {
    routeFetch({ [MAIN_AS_TAG_PATH]: serverError() })

    let lookup = getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(lookup).rejects.toHaveProperty('status', 500)
  })

  it('reports a failed branch lookup instead of reading it as neither', async () => {
    routeFetch({
      [MAIN_AS_BRANCH_PATH]: serverError(),
      [MAIN_AS_TAG_PATH]: notFound(),
    })

    let lookup = getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(lookup).rejects.toHaveProperty('status', 500)
  })

  it('reports a lookup that got no response', async () => {
    routeFetch({ [MAIN_AS_TAG_PATH]: networkFailure() })

    let lookup = getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(lookup).rejects.toBeInstanceOf(TypeError)
  })

  it.each([
    { answer: serverError(), description: 'failed' },
    { description: 'was rate limited', answer: rateLimited() },
  ])('asks again after a lookup that $description', async ({ answer }) => {
    let api = routeFetch({ [MAIN_AS_TAG_PATH]: answer })
    let context = createClientContext()
    let parameters = { reference: 'main', owner: 'actions', repo: 'checkout' }

    await expect(getReferenceType(context, parameters)).rejects.toThrow(Error)
    await expect(getReferenceType(context, parameters)).rejects.toThrow(Error)

    expect(api.paths).toStrictEqual([MAIN_AS_TAG_PATH, MAIN_AS_TAG_PATH])
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [MAIN_AS_TAG_PATH]: rateLimited(resetAt) })

    let lookup = getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })

  it('throws GitHubRateLimitError when the branch lookup is rate limited', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({
      [MAIN_AS_BRANCH_PATH]: rateLimited(resetAt),
      [MAIN_AS_TAG_PATH]: notFound(),
    })

    let lookup = getReferenceType(createClientContext(), {
      reference: 'main',
      owner: 'actions',
      repo: 'checkout',
    })

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
