import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getMatchingTagReferences } from '../../core/api/get-matching-tag-references'

describe('getMatchingTagReferences', () => {
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

  it('maps refs to TagInfo and strips the refs/tags prefix', async () => {
    let fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { object: { type: 'commit', sha: 'a' }, ref: 'refs/tags/pkg-v1.0.0' },
          { object: { type: 'commit', sha: 'b' }, ref: 'refs/tags/pkg-v1.1.0' },
        ]),
        { status: 200 },
      ),
    )

    let tags = await getMatchingTagReferences(context(), {
      prefix: 'pkg-',
      owner: 'o',
      repo: 'r',
    })

    expect(tags).toEqual([
      { tag: 'pkg-v1.0.0', message: null, date: null, sha: 'a' },
      { tag: 'pkg-v1.1.0', message: null, date: null, sha: 'b' },
    ])
    expect(fetchSpy.mock.calls[0]![0]).toContain(
      '/repos/o/r/git/matching-refs/tags/pkg-',
    )
  })

  it('leaves the SHA unresolved for annotated tags', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            object: { sha: 'tag-object', type: 'tag' },
            ref: 'refs/tags/pkg-v2',
          },
        ]),
        { status: 200 },
      ),
    )

    let tags = await getMatchingTagReferences(context(), {
      prefix: 'pkg-',
      owner: 'o',
      repo: 'r',
    })

    expect(tags).toEqual([
      { tag: 'pkg-v2', message: null, date: null, sha: null },
    ])
  })

  it('returns an empty array when nothing matches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    )

    await expect(
      getMatchingTagReferences(context(), {
        prefix: 'nope',
        owner: 'o',
        repo: 'r',
      }),
    ).resolves.toEqual([])
  })

  it('reuses the cache instead of requesting twice', async () => {
    let fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            object: { type: 'commit', sha: 'a' },
            ref: 'refs/tags/pkg-v1.0.0',
          },
        ]),
        { status: 200 },
      ),
    )
    let sharedContext = context()

    let first = await getMatchingTagReferences(sharedContext, {
      prefix: 'pkg-',
      owner: 'o',
      repo: 'r',
    })
    let second = await getMatchingTagReferences(sharedContext, {
      prefix: 'pkg-',
      owner: 'o',
      repo: 'r',
    })

    expect(second).toEqual(first)
    expect(fetchSpy.mock.calls).toHaveLength(1)
  })

  it('caches an empty result for failed lookups', async () => {
    let fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('not found', { status: 404 }))
    let sharedContext = context()

    await expect(
      getMatchingTagReferences(sharedContext, {
        prefix: 'pkg-',
        owner: 'o',
        repo: 'r',
      }),
    ).resolves.toEqual([])
    await expect(
      getMatchingTagReferences(sharedContext, {
        prefix: 'pkg-',
        owner: 'o',
        repo: 'r',
      }),
    ).resolves.toEqual([])
    expect(fetchSpy.mock.calls).toHaveLength(1)
  })

  it('rethrows rate limit failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        headers: { 'x-ratelimit-remaining': '0' },
        status: 403,
      }),
    )

    await expect(
      getMatchingTagReferences(context(), {
        prefix: 'pkg-',
        owner: 'o',
        repo: 'r',
      }),
    ).rejects.toMatchObject({ name: 'GitHubRateLimitError' })
  })
})
