import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getTagSha } from '../../core/api/get-tag-sha'

describe('getTagSha', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function makeContext(): GitHubClientContext {
    return {
      caches: { refType: new Map(), tagInfo: new Map(), tagSha: new Map() },
      baseUrl: 'https://api.github.com',
      rateLimitReset: new Date(0),
      rateLimitRemaining: 5000,
      token: 't',
    }
  }

  it('resolves annotated tag to commit SHA', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      if ((url as string).includes('/git/refs/tags/v1.2.3')) {
        return Promise.resolve(
          new Response(
            /* Cspell:disable-next-line */
            JSON.stringify({ object: { sha: 'tagobj', type: 'tag' } }),
            {
              status: 200,
            },
          ),
        )
      }
      /* Cspell:disable-next-line */
      if ((url as string).includes('/git/tags/tagobj')) {
        return Promise.resolve(
          new Response(JSON.stringify({ object: { sha: 'commit-sha' } }), {
            status: 200,
          }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let sha = await getTagSha(context, { tag: 'v1.2.3', owner: 'o', repo: 'r' })
    expect(sha).toBe('commit-sha')
  })

  it('returns lightweight tag commit SHA', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ object: { type: 'commit', sha: 'light' } }),
        {
          status: 200,
        },
      ),
    )

    let sha = await getTagSha(context, { tag: 'v0.1.0', owner: 'o', repo: 'r' })
    expect(sha).toBe('light')
  })

  it('returns cached entry without performing requests', async () => {
    let context = makeContext()
    context.caches.tagSha.set('o/r#v1.0.0', 'cached')
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let sha = await getTagSha(context, { tag: 'v1.0.0', owner: 'o', repo: 'r' })

    expect(sha).toBe('cached')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when cached entry is null', async () => {
    let context = makeContext()
    context.caches.tagSha.set('o/r#v1.1.0', null)
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let sha = await getTagSha(context, { tag: 'v1.1.0', owner: 'o', repo: 'r' })

    expect(sha).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when cached entry is undefined', async () => {
    let context = makeContext()
    context.caches.tagSha.set('o/r#v1.1.1', undefined as unknown as string)
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let sha = await getTagSha(context, { tag: 'v1.1.1', owner: 'o', repo: 'r' })

    expect(sha).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to ref SHA when annotated tag details fail', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/git/refs/tags/v2.0.0')) {
        return Promise.resolve(
          new Response(
            /* Cspell:disable-next-line */
            JSON.stringify({ object: { sha: 'tagobj', type: 'tag' } }),
            {
              status: 200,
            },
          ),
        )
      }
      /* Cspell:disable-next-line */
      if (urlString.endsWith('/git/tags/tagobj')) {
        return Promise.resolve(new Response('fail', { status: 500 }))
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let sha = await getTagSha(context, { tag: 'v2.0.0', owner: 'o', repo: 'r' })
    /* Cspell:disable-next-line */
    expect(sha).toBe('tagobj')
  })

  it('returns null when annotated tag payload has no object.sha', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/git/refs/tags/v2.2.0')) {
        return Promise.resolve(
          new Response(
            /* Cspell:disable-next-line */
            JSON.stringify({ object: { sha: 'tagobj', type: 'tag' } }),
            {
              status: 200,
            },
          ),
        )
      }
      /* Cspell:disable-next-line */
      if (urlString.endsWith('/git/tags/tagobj')) {
        return Promise.resolve(
          new Response(JSON.stringify({ object: { sha: null } }), {
            status: 200,
          }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let sha = await getTagSha(context, { tag: 'v2.2.0', owner: 'o', repo: 'r' })
    expect(sha).toBeNull()
  })

  it('throws GitHubRateLimitError on rate limit', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('API rate limit exceeded', {
        statusText: 'Forbidden',
        status: 403,
      }),
    )

    await expect(
      getTagSha(context, { tag: 'v0.0.1', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty('name', 'GitHubRateLimitError')
  })

  it('caches null on non rate limit failure', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('fatal', {
        statusText: 'Internal Server Error',
        status: 500,
      }),
    )

    let sha = await getTagSha(context, { tag: 'v9.9.9', owner: 'o', repo: 'r' })

    expect(sha).toBeNull()
    expect(context.caches.tagSha.get('o/r#v9.9.9')).toBeNull()
  })

  it('returns null when ref sha is empty', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ object: { type: 'commit', sha: '' } }), {
        status: 200,
      }),
    )

    let sha = await getTagSha(context, { tag: 'v4.0.0', owner: 'o', repo: 'r' })
    expect(sha).toBeNull()
    expect(context.caches.tagSha.get('o/r#v4.0.0')).toBeNull()
  })

  it('returns commit SHA directly when ref type is commit', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/git/refs/tags/v3.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'directSha', type: 'commit' } }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let sha = await getTagSha(context, { tag: 'v3.0.0', owner: 'o', repo: 'r' })
    expect(sha).toBe('directSha')
    expect(context.caches.tagSha.get('o/r#v3.0.0')).toBe('directSha')
  })
})
