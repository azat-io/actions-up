import { describe, expect, it } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { updateRateLimitInfo } from '../../core/api/update-rate-limit-info'

describe('updateRateLimitInfo', () => {
  it('updates remaining and reset time', () => {
    let context: GitHubClientContext = {
      caches: { refType: new Map(), tagInfo: new Map(), tagSha: new Map() },
      baseUrl: 'https://api.github.com',
      rateLimitReset: new Date(0),
      rateLimitRemaining: 60,
      token: undefined,
    }

    updateRateLimitInfo(context, {
      'x-ratelimit-reset': String(1700000000),
      'x-ratelimit-remaining': '1234',
    })

    expect(context.rateLimitRemaining).toBe(1234)
    expect(context.rateLimitReset).toEqual(new Date(1700000000 * 1000))
  })

  it('supports numeric header values', () => {
    let context: GitHubClientContext = {
      caches: { refType: new Map(), tagInfo: new Map(), tagSha: new Map() },
      baseUrl: 'https://api.github.com',
      rateLimitReset: new Date(0),
      rateLimitRemaining: 60,
      token: undefined,
    }
    updateRateLimitInfo(context, {
      'x-ratelimit-reset': 1700000050 as unknown as string,
      'x-ratelimit-remaining': 42 as unknown as string,
    })
    expect(context.rateLimitRemaining).toBe(42)
    expect(context.rateLimitReset).toEqual(new Date(1700000050 * 1000))
  })
})
