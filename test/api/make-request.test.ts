import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { makeRequest } from '../../core/api/make-request'

describe('makeRequest', () => {
  beforeEach(() => vi.restoreAllMocks())

  function context(token?: string): GitHubClientContext {
    return {
      caches: { refType: new Map(), tagInfo: new Map(), tagSha: new Map() },
      rateLimitRemaining: token ? 5000 : 60,
      baseUrl: 'https://api.github.com',
      rateLimitReset: new Date(0),
      token,
    }
  }

  it('sets Authorization header when token present', async () => {
    let spy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      let headers = init?.headers as Record<string, string>
      expect(headers['Authorization']).toMatch(/^Bearer /u)
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    await makeRequest(context('t'), '/path')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('maps 403 with rate limit message to friendly error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('API rate limit exceeded', {
        statusText: 'Forbidden',
        status: 403,
      }),
    )
    await expect(makeRequest(context(), '/x')).rejects.toHaveProperty(
      'message',
      'API rate limit exceeded',
    )
  })

  it('keeps default error message when not a rate-limit 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Forbidden', { statusText: 'Forbidden', status: 403 }),
    )
    await expect(makeRequest(context(), '/x')).rejects.toHaveProperty(
      'message',
      'GitHub API error: 403 Forbidden',
    )
  })

  it('updates rate limit fields from headers on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        headers: {
          'x-ratelimit-reset': String(1700000001),
          'x-ratelimit-remaining': '123',
        } as unknown as HeadersInit,
        status: 200,
      }),
    )

    let contextObject = context()
    await makeRequest(contextObject, '/ok')
    expect(contextObject.rateLimitRemaining).toBe(123)
    expect(contextObject.rateLimitReset).toEqual(new Date(1700000001 * 1000))
  })
})
