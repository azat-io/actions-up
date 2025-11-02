import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getReferenceType } from '../../core/api/get-reference-type'

describe('getReferenceType', () => {
  beforeEach(() => vi.restoreAllMocks())

  function context(): GitHubClientContext {
    return {
      caches: { refType: new Map(), tagInfo: new Map(), tagSha: new Map() },
      baseUrl: 'https://api.github.com',
      rateLimitReset: new Date(0),
      rateLimitRemaining: 5000,
      token: 't',
    }
  }

  it('returns tag when tag ref exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    )
    let t = await getReferenceType(context(), {
      reference: 'v1',
      owner: 'o',
      repo: 'r',
    })
    expect(t).toBe('tag')
  })

  it('returns branch when tag 404 and head exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      if (String(url as URL).includes('/git/refs/tags/')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
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
})
