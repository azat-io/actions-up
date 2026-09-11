import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getReferenceType } from '../../core/api/get-reference-type'

describe('getReferenceType', () => {
  beforeEach(() => vi.restoreAllMocks())

  function context(): GitHubClientContext {
    return {
      caches: {
        matchingReferences: new Map(),
        refType: new Map(),
        tagInfo: new Map(),
        tagSha: new Map(),
      },
      baseUrl: 'https://api.github.com',
      rateLimitReset: new Date(0),
      rateLimitRemaining: 5000,
      token: 't',
    }
  }

  it('returns tag when tag ref exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString = typeof input === 'string' ? input : (input as URL).href
      if (urlString.endsWith('/repos/o/r/git/ref/tags/v1')) {
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let t = await getReferenceType(context(), {
      reference: 'v1',
      owner: 'o',
      repo: 'r',
    })
    expect(t).toBe('tag')
  })

  it('returns branch when tag 404 and head exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString = typeof input === 'string' ? input : (input as URL).href
      if (urlString.includes('/git/ref/tags/')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.includes('/git/ref/heads/')) {
        return Promise.resolve(new Response('{}', { status: 200 }))
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let t = await getReferenceType(context(), {
      reference: 'main',
      owner: 'o',
      repo: 'r',
    })
    expect(t).toBe('branch')
  })

  it('returns null when neither tag nor head exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )
    let t = await getReferenceType(context(), {
      reference: 'x',
      owner: 'o',
      repo: 'r',
    })
    expect(t).toBeNull()
  })

  it('returns cached entry without issuing requests', async () => {
    let context_ = context()
    context_.caches.refType.set('o/r#main', 'branch')
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let result = await getReferenceType(context_, {
      reference: 'main',
      owner: 'o',
      repo: 'r',
    })

    expect(result).toBe('branch')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when cached entry stores null', async () => {
    let context_ = context()
    context_.caches.refType.set('o/r#main', null)
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let result = await getReferenceType(context_, {
      reference: 'main',
      owner: 'o',
      repo: 'r',
    })

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('throws when the tag lookup fails without a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server failure', {
        statusText: 'Internal Server Error',
        status: 500,
      }),
    )
    let context_ = context()

    await expect(
      getReferenceType(context_, { reference: 'main', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty(
      'message',
      expect.stringContaining('GitHub API error'),
    )
    expect(context_.caches.refType.has('o/r#main')).toBeFalsy()
  })

  it('throws when the branch lookup fails without a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString = typeof input === 'string' ? input : (input as URL).href
      if (urlString.includes('/git/ref/tags/')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      return Promise.resolve(
        new Response('Server failure', {
          statusText: 'Internal Server Error',
          status: 500,
        }),
      )
    })
    let context_ = context()

    await expect(
      getReferenceType(context_, { reference: 'main', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty(
      'message',
      expect.stringContaining('GitHub API error'),
    )
    expect(context_.caches.refType.has('o/r#main')).toBeFalsy()
  })

  it('throws when the lookup fails without a response', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed'),
    )
    let context_ = context()

    await expect(
      getReferenceType(context_, { reference: 'main', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty('message', 'fetch failed')
    expect(context_.caches.refType.has('o/r#main')).toBeFalsy()
  })

  it('throws GitHubRateLimitError when the tag lookup is rate limited', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('API rate limit exceeded', {
        statusText: 'Forbidden',
        status: 403,
      }),
    )
    let context_ = context()

    await expect(
      getReferenceType(context_, { reference: 'main', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty('name', 'GitHubRateLimitError')
    expect(context_.caches.refType.has('o/r#main')).toBeFalsy()
  })

  it('throws GitHubRateLimitError when the branch lookup is rate limited', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString = typeof input === 'string' ? input : (input as URL).href
      if (urlString.includes('/git/ref/tags/')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      return Promise.resolve(
        new Response('API rate limit exceeded', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )
    })
    let context_ = context()

    await expect(
      getReferenceType(context_, { reference: 'main', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty('name', 'GitHubRateLimitError')
    expect(context_.caches.refType.has('o/r#main')).toBeFalsy()
  })
})
