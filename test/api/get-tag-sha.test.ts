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
})
