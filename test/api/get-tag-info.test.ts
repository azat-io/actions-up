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

  it('returns cached info before performing requests', async () => {
    let context = makeContext()
    let cached = {
      message: 'cached',
      tag: 'v1.2.3',
      date: null,
      sha: 'sha',
    }
    context.caches.tagInfo.set('o/r#v1.2.3', cached)
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let info = await getTagInfo(context, {
      tag: 'v1.2.3',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toBe(cached)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when cached entry is null', async () => {
    let context = makeContext()
    context.caches.tagInfo.set('o/r#v1.2.4', null)
    let fetchSpy = vi.spyOn(globalThis, 'fetch')

    let info = await getTagInfo(context, {
      tag: 'v1.2.4',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('preserves annotated ref sha when release tag detail lookup fails', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-03-01T00:00:00Z',
              body: 'Release message',
              target_commitish: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v4.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'tagRef', type: 'tag' } }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/tags/tagRef')) {
        return Promise.resolve(
          new Response('error', {
            statusText: 'Internal Server Error',
            status: 500,
          }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.0.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-01T00:00:00Z'),
      message: 'Release message',
      tag: 'v4.0.0',
      sha: 'tagRef',
    })
  })

  it('ignores commit enrichment failure in release path for commit refs', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.4.1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-03-10T00:00:00Z',
              target_commitish: 'commitSha',
              body: 'Release message',
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v4.4.1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'commitSha', type: 'commit' } }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/commitSha')) {
        return Promise.resolve(new Response('error', { status: 500 }))
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.4.1',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-10T00:00:00Z'),
      message: 'Release message',
      sha: 'commitSha',
      tag: 'v4.4.1',
    })
  })

  it('enriches release commit reference via commit lookup', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.1.0')) {
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
      if (urlString.endsWith('/git/refs/tags/v4.1.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'commit123', type: 'commit' } }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/commit123')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              author: { date: '2024-03-02T00:00:00Z' },
              message: 'Commit message',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.1.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-02T00:00:00Z'),
      message: 'Commit message',
      sha: 'commit123',
      tag: 'v4.1.0',
    })
  })

  it('uses release commitish when reference lookup fails', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.2.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-03-05T00:00:00Z',
              target_commitish: 'deadbeef',
              body: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.includes('/git/refs/tags/')) {
        return Promise.resolve(
          new Response('Not Found', { statusText: 'Not Found', status: 404 }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.2.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-05T00:00:00Z'),
      sha: 'deadbeef',
      tag: 'v4.2.0',
      message: null,
    })
  })

  it('ignores release commitish that is not a SHA when reference lookup fails', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.2.1')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-03-05T00:00:00Z',
              target_commitish: 'main',
              body: null,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response('Not Found', { status: 404 }))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.2.1',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-05T00:00:00Z'),
      tag: 'v4.2.1',
      message: null,
      sha: null,
    })
  })

  it('ignores null release commitish when reference lookup fails', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.2.2')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-03-05T00:00:00Z',
              target_commitish: null,
              body: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v4.2.2')) {
        return Promise.resolve(
          new Response('Not Found', {
            statusText: 'Not Found',
            status: 404,
          }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.2.2',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-05T00:00:00Z'),
      tag: 'v4.2.2',
      message: null,
      sha: null,
    })
  })

  it('ignores blank release commitish when reference lookup fails', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.2.3')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-03-05T00:00:00Z',
              target_commitish: '   ',
              body: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v4.2.3')) {
        return Promise.resolve(
          new Response('Not Found', {
            statusText: 'Not Found',
            status: 404,
          }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.2.3',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-03-05T00:00:00Z'),
      tag: 'v4.2.3',
      message: null,
      sha: null,
    })
  })

  it('preserves ref sha when fallback tag detail lookup fails', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.3.0')) {
        return Promise.resolve(
          new Response('Not Found', { statusText: 'Not Found', status: 404 }),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v4.3.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'tagRef', type: 'tag' } }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/tags/tagRef')) {
        return Promise.resolve(
          new Response('fail', {
            statusText: 'Server Error',
            status: 500,
          }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.3.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      tag: 'v4.3.0',
      message: null,
      sha: 'tagRef',
      date: null,
    })
  })

  it('returns null when tag lookup fails with status error', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v4.4.0')) {
        return Promise.resolve(
          new Response('Not Found', { statusText: 'Not Found', status: 404 }),
        )
      }
      if (urlString.includes('/git/refs/tags/')) {
        return Promise.resolve(
          new Response('Forbidden', { statusText: 'Forbidden', status: 403 }),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v4.4.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toBeNull()
    expect(context.caches.tagInfo.get('o/r#v4.4.0')).toBeNull()
  })

  it('throws GitHubRateLimitError when API signals rate limit', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('rate limit triggered'),
    )

    await expect(
      getTagInfo(context, { tag: 'v5.0.0', owner: 'o', repo: 'r' }),
    ).rejects.toHaveProperty('name', 'GitHubRateLimitError')
  })

  it('rethrows unexpected errors from both release and fallback paths', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fatal'))

    await expect(
      getTagInfo(context, { tag: 'v6.0.0', owner: 'o', repo: 'r' }),
    ).rejects.toThrowError('fatal')
  })

  it('enriches missing date from commit when release has body but no date', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v5.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              target_commitish: null,
              body: 'Release notes',
              published_at: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v5.0.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'commit456', type: 'commit' } }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/commit456')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              author: { date: '2024-04-01T00:00:00Z' },
              message: 'Commit msg',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v5.0.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-04-01T00:00:00Z'),
      message: 'Release notes',
      sha: 'commit456',
      tag: 'v5.0.0',
    })
  })

  it('enriches missing message from commit when release has date but no body', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v5.1.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-04-02T00:00:00Z',
              target_commitish: null,
              body: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v5.1.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { sha: 'commit789', type: 'commit' } }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/commits/commit789')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              author: { date: '2024-04-03T00:00:00Z' },
              message: 'Commit description',
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v5.1.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-04-02T00:00:00Z'),
      message: 'Commit description',
      sha: 'commit789',
      tag: 'v5.1.0',
    })
  })

  it('keeps release info when ref sha is empty', async () => {
    let context = makeContext()
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      let input = url as unknown
      let urlString =
        typeof input === 'string' ? input : (input as URL).toString()
      if (urlString.endsWith('/releases/tags/v5.2.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              published_at: '2024-04-04T00:00:00Z',
              body: 'Release summary',
              target_commitish: null,
            }),
            { status: 200 },
          ),
        )
      }
      if (urlString.endsWith('/git/refs/tags/v5.2.0')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ object: { type: 'commit', sha: '' } }),
            { status: 200 },
          ),
        )
      }
      return Promise.reject(new Error('Unexpected URL'))
    })

    let info = await getTagInfo(context, {
      tag: 'v5.2.0',
      owner: 'o',
      repo: 'r',
    })

    expect(info).toEqual({
      date: new Date('2024-04-04T00:00:00Z'),
      message: 'Release summary',
      tag: 'v5.2.0',
      sha: null,
    })
  })
})

/* eslint-enable camelcase */
