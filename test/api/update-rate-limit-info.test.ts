import { describe, expect, it } from 'vitest'

import { updateRateLimitInfo } from '../../core/api/update-rate-limit-info'
import { createClientContext } from '../helpers/create-client-context'

describe('updateRateLimitInfo', () => {
  it('updates remaining and reset time', () => {
    let context = createClientContext({
      rateLimitRemaining: 60,
      token: undefined,
    })

    updateRateLimitInfo(context, {
      'x-ratelimit-reset': String(1700000000),
      'x-ratelimit-remaining': '1234',
    })

    expect(context.rateLimitRemaining).toBe(1234)
    expect(context.rateLimitReset).toEqual(new Date(1700000000 * 1000))
  })

  it('supports numeric header values', () => {
    let context = createClientContext({
      rateLimitRemaining: 60,
      token: undefined,
    })
    updateRateLimitInfo(context, {
      'x-ratelimit-reset': 1700000050,
      'x-ratelimit-remaining': 42,
    })
    expect(context.rateLimitRemaining).toBe(42)
    expect(context.rateLimitReset).toEqual(new Date(1700000050 * 1000))
  })
})
