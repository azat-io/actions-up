import { describe, expect, it } from 'vitest'

import { updateRateLimitInfo } from '../../core/api/update-rate-limit-info'
import { createClientContext } from '../helpers/create-client-context'
import { rateLimitHeaders } from '../helpers/route-fetch'

const PREVIOUS_REMAINING = 4999

/**
 * Reset moment the response announces.
 *
 * @returns Fresh date.
 */
function announcedReset(): Date {
  return new Date('2026-10-03T14:37:21.000Z')
}

/**
 * Reset moment the context held before the response arrived.
 *
 * @returns Fresh date.
 */
function previousReset(): Date {
  return new Date('2026-10-03T13:00:00.000Z')
}

describe('updateRateLimitInfo', () => {
  it.each([
    {
      headers: rateLimitHeaders({ resetAt: announcedReset(), remaining: 4321 }),
      expected: { resetAt: announcedReset(), remaining: 4321 },
      description: 'takes both headers given as text',
    },
    {
      headers: {
        'x-ratelimit-reset': announcedReset().getTime() / 1000,
        'x-ratelimit-remaining': 42,
      },
      expected: { resetAt: announcedReset(), remaining: 42 },
      description: 'takes both headers given as numbers',
    },
    {
      headers: rateLimitHeaders({ resetAt: announcedReset(), remaining: 0 }),
      expected: { resetAt: announcedReset(), remaining: 0 },
      description: 'takes an exhausted allowance',
    },
    {
      expected: { remaining: PREVIOUS_REMAINING, resetAt: previousReset() },
      description: 'keeps the previous state without rate limit headers',
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
    {
      description:
        'updates only the remaining count when the reset time is absent',
      expected: { resetAt: previousReset(), remaining: 17 },
      headers: rateLimitHeaders({ remaining: 17 }),
    },
    {
      description:
        'updates only the reset time when the remaining count is absent',
      expected: { remaining: PREVIOUS_REMAINING, resetAt: announcedReset() },
      headers: rateLimitHeaders({ resetAt: announcedReset() }),
    },
  ])('$description', ({ expected, headers }) => {
    let context = createClientContext({
      rateLimitRemaining: PREVIOUS_REMAINING,
      rateLimitReset: previousReset(),
    })

    updateRateLimitInfo(context, headers)

    expect({
      remaining: context.rateLimitRemaining,
      resetAt: context.rateLimitReset,
    }).toStrictEqual(expected)
  })
})
