/* eslint-disable camelcase */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getTagInfo } from '../../core/api/get-tag-info'

describe('getTagInfo', () => {
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

  it('fetches release-by-tag then resolves SHA via refs', async () => {
    let context = makeContext()

    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v1.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-01-01T00:00:00Z',
              target_commitish: 'abc',
              body: 'Rel body',
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v1.0.0')) {
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
          new Response(
            JSON.stringify({
              tagger: { date: '2023-12-31T10:00:00Z' },
              object: { sha: 'final' },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v1.0.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      date: new Date('2024-01-01T00:00:00Z'),
      message: 'Rel body',
      tag: 'v1.0.0',
      sha: 'final',
    })
  })

  it('falls back to refs when release-by-tag is not found', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v2.0.0')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v2.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { type: 'commit', sha: 'light' } }),
            {
              status: 200,
            },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/light')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              author: { date: '2024-02-01T00:00:00Z' },
              message: 'M',
            }),
            {
              status: 200,
            },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v2.0.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      date: new Date('2024-02-01T00:00:00Z'),
      tag: 'v2.0.0',
      message: 'M',
      sha: 'light',
    })
  })

  it('ignores commit enrichment failure for commit-type ref', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v2.1.0')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v2.1.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { type: 'commit', sha: 'sha123' } }),
            {
              status: 200,
            },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/sha123')) {
        return Promise.resolve(new Response('oops', { status: 500 }))
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let info = await getTagInfo(context, {
      tag: 'v2.1.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      tag: 'v2.1.0',
      sha: 'sha123',
      message: null,
      date: null,
    })
  })

  it('sets date to null when commit author date is null (commit-type ref)', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v2.1.1')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v2.1.1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { type: 'commit', sha: 'sha456' } }),
            {
              status: 200,
            },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/sha456')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              author: { date: null },
              message: 'Msg',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let info = await getTagInfo(context, {
      tag: 'v2.1.1',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      message: 'Msg',
      tag: 'v2.1.1',
      sha: 'sha456',
      date: null,
    })
  })

  it('keeps ref sha when annotated tag object.sha is missing, but fills metadata', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v3.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              target_commitish: null,
              published_at: null,
              body: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v3.0.0')) {
        return Promise.resolve(
          new Response(
            /* Cspell:disable-next-line */
            JSON.stringify({ object: { sha: 'refsha', type: 'tag' } }),
            {
              status: 200,
            },
          ),
        )
      }
      /* Cspell:disable-next-line */
      if (urlString.endsWith('/git/tags/refsha')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tagger: { date: '2024-02-02T00:00:00Z' },
              object: { sha: null },
              message: 'T',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v3.0.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      date: new Date('2024-02-02T00:00:00Z'),
      tag: 'v3.0.0',
      /* Cspell:disable-next-line */
      sha: 'refsha',
      message: 'T',
    })
  })

  it('fills metadata and sha when annotated tag details present (fallback path)', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v3.1.0')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v3.1.0')) {
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
          new Response(
            JSON.stringify({
              tagger: { date: '2024-02-03T00:00:00Z' },
              /* Cspell:disable-next-line */
              object: { sha: 'finalsha' },
              message: 'Tag message',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let info = await getTagInfo(context, {
      tag: 'v3.1.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      date: new Date('2024-02-03T00:00:00Z'),
      message: 'Tag message',
      /* Cspell:disable-next-line */
      sha: 'finalsha',
      tag: 'v3.1.0',
    })
  })

  it('keeps message/date null when annotated tag has no message and no tagger date (fallback path)', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v3.2.0')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v3.2.0')) {
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
          new Response(
            JSON.stringify({
              /* Cspell:disable-next-line */
              object: { sha: 'finalsha' },
              tagger: { date: null },
              message: null,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let info = await getTagInfo(context, {
      tag: 'v3.2.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      /* Cspell:disable-next-line */
      sha: 'finalsha',
      tag: 'v3.2.0',
      message: null,
      date: null,
    })
  })

  it('sets message null when commit message is null (fallback commit path)', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v2.1.2')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v2.1.2')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { type: 'commit', sha: 'sha789' } }),
            {
              status: 200,
            },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/sha789')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              author: { date: '2024-02-04T00:00:00Z' },
              message: null,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let info = await getTagInfo(context, {
      tag: 'v2.1.2',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      date: new Date('2024-02-04T00:00:00Z'),
      tag: 'v2.1.2',
      sha: 'sha789',
      message: null,
    })
  })

  it('keeps ref sha when annotated tag object.sha is missing (fallback path)', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v3.3.0')) {
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      }
      if (urlString.endsWith('/git/refs/tags/v3.3.0')) {
        return Promise.resolve(
          new Response(
            /* Cspell:disable-next-line */
            JSON.stringify({ object: { sha: 'refsha', type: 'tag' } }),
            {
              status: 200,
            },
          ),
        )
      }
      /* Cspell:disable-next-line */
      if (urlString.endsWith('/git/tags/refsha')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tagger: { date: '2024-02-05T00:00:00Z' },
              object: { sha: null },
              message: 'T',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })
    let info = await getTagInfo(context, {
      tag: 'v3.3.0',
      owner: 'o',
      repo: 'r',
    })
    expect(info).toEqual({
      date: new Date('2024-02-05T00:00:00Z'),
      tag: 'v3.3.0',
      /* Cspell:disable-next-line */
      sha: 'refsha',
      message: 'T',
    })
  })
})

/* eslint-enable camelcase */
