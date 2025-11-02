/* eslint-disable camelcase */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getAllReleases } from '../../core/api/get-all-releases'

describe('getAllReleases', () => {
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

  it('returns releases and resolves first item sha from target_commitish when looks like SHA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            published_at: '2024-01-01T00:00:00Z',
            /* Cspell:disable-next-line */
            target_commitish: 'deadbeefcafe',
            tag_name: 'v1.0.0',
            prerelease: false,
            html_url: 'u',
            body: null,
            name: 'A',
          },
          {
            published_at: '2024-02-01T00:00:00Z',
            target_commitish: 'main',
            tag_name: 'v1.1.0',
            prerelease: false,
            html_url: 'u2',
            body: null,
            name: 'B',
          },
        ]),
        { status: 200 },
      ),
    )

    let array = await getAllReleases(context(), {
      owner: 'o',
      repo: 'r',
      limit: 2,
    })
    expect(array).toHaveLength(2)
    /* Cspell:disable-next-line */
    expect(array[0]!.sha).toBe('deadbeefcafe')
    expect(array[1]!.sha).toBeNull()
  })

  it('sets first item sha to null when target_commitish is not a SHA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            published_at: '2024-01-01T00:00:00Z',
            target_commitish: 'main',
            tag_name: 'v1.0.0',
            prerelease: false,
            html_url: 'u',
            body: null,
            name: 'A',
          },
        ]),
        { status: 200 },
      ),
    )
    let array = await getAllReleases(context(), {
      owner: 'o',
      repo: 'r',
      limit: 1,
    })
    expect(array[0]!.sha).toBeNull()
  })

  it('falls back name to tag_name when name is null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            published_at: '2024-03-10T00:00:00Z',
            target_commitish: null,
            tag_name: 'v2.0.0',
            prerelease: false,
            html_url: 'u',
            name: null,
            body: 'd',
          },
        ]),
        { status: 200 },
      ),
    )
    let array = await getAllReleases(context(), {
      owner: 'o',
      repo: 'r',
      limit: 1,
    })
    expect(array[0]!.name).toBe('v2.0.0')
  })

  it('throws GitHubRateLimitError when API reports rate limit exceeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('API rate limit exceeded', {
        statusText: 'Forbidden',
        status: 403,
      }),
    )

    await expect(
      getAllReleases(context(), { owner: 'o', repo: 'r', limit: 1 }),
    ).rejects.toHaveProperty('name', 'GitHubRateLimitError')
  })

  it('rethrows unexpected errors from makeRequest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Upstream failure', {
        statusText: 'Internal Server Error',
        status: 500,
      }),
    )

    await expect(
      getAllReleases(context(), { owner: 'o', repo: 'r', limit: 1 }),
    ).rejects.toHaveProperty(
      'message',
      expect.stringContaining('GitHub API error'),
    )
  })
})

/* eslint-enable camelcase */
