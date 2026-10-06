/* eslint-disable camelcase */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  rateLimitHeaders,
  serverError,
  rateLimited,
  routeFetch,
  forbidden,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { createClientContext } from '../../helpers/create-client-context'
import { makeRequest } from '../../../core/api/make-request'

const PATH = '/repos/actions/checkout/releases/latest'

/**
 * Reset moment the responses announce.
 *
 * @returns Fresh date.
 */
function announcedReset(): Date {
  return new Date('2026-10-03T14:37:21.000Z')
}

describe('makeRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('requests the path from the GitHub API as JSON on behalf of the tool', async () => {
    let api = routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })

    await makeRequest(createClientContext(), PATH)

    expect(api.paths).toStrictEqual([PATH])
    expect(api.headers[0]).toMatchObject({
      accept: 'application/vnd.github.v3+json',
      'user-agent': 'actions-up',
    })
  })

  it('authenticates with the token as a bearer credential', async () => {
    let api = routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })

    await makeRequest(createClientContext({ token: 'explicit-token' }), PATH)

    expect(api.headers[0]).toHaveProperty(
      'authorization',
      'Bearer explicit-token',
    )
  })

  it.each([
    { description: 'without a token', token: undefined },
    { description: 'with an empty token', token: '' },
  ])('sends no authorization header $description', async ({ token }) => {
    let api = routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })

    await makeRequest(createClientContext({ token }), PATH)

    expect(api.headers[0]).not.toHaveProperty('authorization')
  })

  it('returns the parsed body together with the response headers', async () => {
    routeFetch({
      [PATH]: ok(
        { tag_name: 'v4.2.2', prerelease: false },
        { 'x-ratelimit-remaining': '4999' },
      ),
    })

    let response = await makeRequest(createClientContext(), PATH)

    expect(response.data).toStrictEqual({
      tag_name: 'v4.2.2',
      prerelease: false,
    })
    expect(response.headers).toMatchObject({ 'x-ratelimit-remaining': '4999' })
  })

  it.each([
    {
      description: 'the primary rate limit',
      answer: rateLimited(announcedReset()),
    },
    {
      answer: forbidden(
        'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      ),
      description: 'a secondary rate limit',
    },
  ])(
    'rejects $description as a rate limit error with status 403',
    async ({ answer }) => {
      routeFetch({ [PATH]: answer })

      let request = makeRequest(createClientContext(), PATH)

      await expect(request).rejects.toStrictEqual(
        Object.assign(new Error('API rate limit exceeded'), { status: 403 }),
      )
    },
  )

  it.each([
    {
      expected: Object.assign(new Error('GitHub API error: 403 Forbidden'), {
        status: 403,
      }),
      answer: forbidden('Resource not accessible by integration'),
      description: 'a refused request',
    },
    {
      expected: Object.assign(new Error('GitHub API error: 404 Not Found'), {
        status: 404,
      }),
      description: 'a missing resource',
      answer: notFound(),
    },
    {
      expected: Object.assign(
        new Error('GitHub API error: 500 Internal Server Error'),
        { status: 500 },
      ),
      description: 'a server failure',
      answer: serverError(),
    },
  ])(
    'rejects $description with its status line and status code',
    async ({ expected, answer }) => {
      routeFetch({ [PATH]: answer })

      let request = makeRequest(createClientContext(), PATH)

      await expect(request).rejects.toStrictEqual(expected)
    },
  )

  it('records the rate limit state of a successful response', async () => {
    routeFetch({
      [PATH]: ok(
        { tag_name: 'v4.2.2' },
        rateLimitHeaders({ resetAt: announcedReset(), remaining: 4321 }),
      ),
    })
    let context = createClientContext()

    await makeRequest(context, PATH)

    expect(context).toMatchObject({
      rateLimitReset: announcedReset(),
      rateLimitRemaining: 4321,
    })
  })

  it('records the rate limit state of a rate-limited response', async () => {
    routeFetch({ [PATH]: rateLimited(announcedReset()) })
    let context = createClientContext()

    await expect(makeRequest(context, PATH)).rejects.toThrow(
      'API rate limit exceeded',
    )

    expect(context).toMatchObject({
      rateLimitReset: announcedReset(),
      rateLimitRemaining: 0,
    })
  })
})

/* eslint-enable camelcase */
