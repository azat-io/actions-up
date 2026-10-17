/* eslint-disable camelcase */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  rateLimitHeaders,
  tooManyRequests,
  networkFailure,
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

  it('rejects a response with status 429 as a rate limit error', async () => {
    routeFetch({ [PATH]: tooManyRequests() })

    let request = makeRequest(createClientContext(), PATH)

    await expect(request).rejects.toStrictEqual(
      Object.assign(new Error('API rate limit exceeded'), { status: 429 }),
    )
  })

  describe('with a retry-after header', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      {
        answer: tooManyRequests({
          ...rateLimitHeaders({ resetAt: announcedReset(), remaining: 4999 }),
          'retry-after': '60',
        }),
        description: 'status 429',
      },
      {
        answer: rateLimited(announcedReset(), { 'retry-after': '60' }),
        description: 'status 403',
      },
    ])(
      'takes the wait of a rate-limited response with $description as the reset moment',
      async ({ answer }) => {
        vi.useFakeTimers({ now: new Date('2026-10-03T14:00:00.000Z') })
        routeFetch({ [PATH]: answer })
        let context = createClientContext()

        await expect(makeRequest(context, PATH)).rejects.toThrow(
          'API rate limit exceeded',
        )

        expect(context.rateLimitReset).toStrictEqual(
          new Date('2026-10-03T14:01:00.000Z'),
        )
      },
    )

    it('keeps the announced reset moment when the wait is not a number of seconds', async () => {
      routeFetch({
        [PATH]: tooManyRequests({
          ...rateLimitHeaders({ resetAt: announcedReset() }),
          'retry-after': 'Sat, 03 Oct 2026 14:01:00 GMT',
        }),
      })
      let context = createClientContext()

      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'API rate limit exceeded',
      )

      expect(context.rateLimitReset).toStrictEqual(announcedReset())
    })

    it('ignores the wait of a response that is not rate limited', async () => {
      routeFetch({
        [PATH]: { ...serverError(), headers: { 'retry-after': '60' } },
      })
      let context = createClientContext()

      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'GitHub API error: 500 Internal Server Error',
      )

      expect(context.rateLimitReset).toStrictEqual(new Date(0))
    })
  })

  describe('repeated requests', () => {
    let OTHER_PATH = '/repos/actions/setup-node/releases/latest'

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sends a request once for lookups that start together', async () => {
      let api = routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })
      let context = createClientContext()

      let responses = await Promise.all([
        makeRequest(context, PATH),
        makeRequest(context, PATH),
      ])

      expect(responses[0]).toBe(responses[1])
      expect(api.paths).toStrictEqual([PATH])
    })

    it('answers a later lookup from the response of the first one', async () => {
      let api = routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })
      let context = createClientContext()

      let first = await makeRequest(context, PATH)
      let second = await makeRequest(context, PATH)

      expect(second).toBe(first)
      expect(api.paths).toStrictEqual([PATH])
    })

    it('answers a later lookup of a missing resource without asking again', async () => {
      let api = routeFetch({ [PATH]: notFound() })
      let context = createClientContext()

      let first = makeRequest(context, PATH)
      await expect(first).rejects.toThrow('GitHub API error: 404 Not Found')
      let second = makeRequest(context, PATH)

      expect(second).toBe(first)
      expect(api.paths).toStrictEqual([PATH])
    })

    it('asks again after a request that failed for another reason', async () => {
      let api = routeFetch({ [PATH]: serverError() })
      let context = createClientContext()

      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'GitHub API error: 500 Internal Server Error',
      )
      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'GitHub API error: 500 Internal Server Error',
      )

      expect(api.paths).toStrictEqual([PATH, PATH])
    })

    it('asks again after a request that got no response', async () => {
      let api = routeFetch({ [PATH]: networkFailure() })
      let context = createClientContext()

      await expect(makeRequest(context, PATH)).rejects.toThrow('fetch failed')
      await expect(makeRequest(context, PATH)).rejects.toThrow('fetch failed')

      expect(api.paths).toStrictEqual([PATH, PATH])
    })

    it('keeps the reset moment of the first rate limit when a response in flight lands later', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-03T14:00:00.000Z') })
      let late = Promise.withResolvers<Response>()
      vi.spyOn(globalThis, 'fetch').mockImplementation(input =>
        typeof input === 'string' && input.endsWith(OTHER_PATH) ?
          late.promise
        : Promise.resolve(
            new Response('{"message":"secondary rate limit"}', {
              headers: { 'retry-after': '60' },
              statusText: 'Too Many Requests',
              status: 429,
            }),
          ),
      )
      let context = createClientContext()

      let inFlight = makeRequest(context, OTHER_PATH)
      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'API rate limit exceeded',
      )
      late.resolve(
        new Response('{"tag_name":"v4.4.0"}', {
          headers: rateLimitHeaders({
            resetAt: announcedReset(),
            remaining: 4,
          }),
          status: 200,
        }),
      )
      await inFlight

      expect(context).toMatchObject({
        rateLimitReset: new Date('2026-10-03T14:01:00.000Z'),
      })
    })

    it('keeps the wait of the first rate limit when a later one asks for another', async () => {
      vi.useFakeTimers({ now: new Date('2026-10-03T14:00:00.000Z') })
      let late = Promise.withResolvers<Response>()
      function limited(retryAfter: string): Response {
        return new Response('{"message":"secondary rate limit"}', {
          headers: { 'retry-after': retryAfter },
          statusText: 'Too Many Requests',
          status: 429,
        })
      }
      vi.spyOn(globalThis, 'fetch').mockImplementation(input =>
        typeof input === 'string' && input.endsWith(OTHER_PATH) ?
          late.promise
        : Promise.resolve(limited('60')),
      )
      let context = createClientContext()

      let inFlight = makeRequest(context, OTHER_PATH)
      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'API rate limit exceeded',
      )
      late.resolve(limited('600'))

      await expect(inFlight).rejects.toThrow('API rate limit exceeded')
      expect(context.rateLimitReset).toStrictEqual(
        new Date('2026-10-03T14:01:00.000Z'),
      )
    })

    it('keeps the requests of different clients apart', async () => {
      let api = routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })

      await makeRequest(createClientContext(), PATH)
      await makeRequest(createClientContext(), PATH)

      expect(api.paths).toStrictEqual([PATH, PATH])
    })

    it('refuses later requests with the rate limit once one was rate limited, without sending them', async () => {
      let api = routeFetch({
        [OTHER_PATH]: ok({ tag_name: 'v4.4.0' }),
        [PATH]: rateLimited(announcedReset()),
      })
      let context = createClientContext()

      await expect(makeRequest(context, PATH)).rejects.toThrow(
        'API rate limit exceeded',
      )
      let refused = makeRequest(context, OTHER_PATH)

      await expect(refused).rejects.toStrictEqual(
        Object.assign(new Error('API rate limit exceeded'), { status: 403 }),
      )
      expect(api.paths).toStrictEqual([PATH])
    })
  })

  it('abandons a request that takes longer than 30 seconds', async () => {
    routeFetch({ [PATH]: ok({ tag_name: 'v4.2.2' }) })
    let timeout = vi.spyOn(AbortSignal, 'timeout')

    await makeRequest(createClientContext(), PATH)

    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal).toBe(
      timeout.mock.results[0]?.value,
    )
  })
})

/* eslint-enable camelcase */
