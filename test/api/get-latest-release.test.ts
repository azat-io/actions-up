/* eslint-disable camelcase */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubClientContext } from '../../types/github-client-context'

import { getLatestRelease } from '../../core/api/get-latest-release'

describe('getLatestRelease', () => {
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

  it('returns normalized latest release', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          published_at: '2024-03-01T00:00:00Z',
          target_commitish: 'abc1234',
          tag_name: 'v3.0.0',
          prerelease: false,
          html_url: 'u',
          body: 'Desc',
          name: 'Rel',
        }),
        { status: 200 },
      ),
    )
    let release = await getLatestRelease(context(), 'o', 'r')
    expect(release).toMatchObject({
      version: 'v3.0.0',
      sha: 'abc1234',
      name: 'Rel',
    })
  })

  it('returns null on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )
    let release = await getLatestRelease(context(), 'o', 'r')
    expect(release).toBeNull()
  })

  it('falls back name to tag_name and description to null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          published_at: '2024-03-01T00:00:00Z',
          target_commitish: null,
          tag_name: 'v3.0.0',
          prerelease: false,
          html_url: 'u',
          body: null,
          name: null,
        }),
        { status: 200 },
      ),
    )
    let release = await getLatestRelease(context(), 'o', 'r')
    expect(release).toMatchObject({ description: null, name: 'v3.0.0' })
  })

  it('throws GitHubRateLimitError on rate limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('API rate limit exceeded', {
        statusText: 'Forbidden',
        status: 403,
      }),
    )
    await expect(getLatestRelease(context(), 'o', 'r')).rejects.toHaveProperty(
      'name',
      'GitHubRateLimitError',
    )
  })

  it('leaves sha null when target_commitish is not a SHA', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          published_at: '2024-03-01T00:00:00Z',
          target_commitish: 'main',
          tag_name: 'v3.0.0',
          prerelease: false,
          html_url: 'u',
          body: 'Desc',
          name: 'Rel',
        }),
        { status: 200 },
      ),
    )
    let release = await getLatestRelease(context(), 'o', 'r')
    expect(release?.sha).toBeNull()
  })

  it('rethrows unexpected errors from makeRequest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server failure', {
        statusText: 'Internal Server Error',
        status: 500,
      }),
    )

    await expect(getLatestRelease(context(), 'o', 'r')).rejects.toHaveProperty(
      'message',
      expect.stringContaining('GitHub API error'),
    )
  })
})

/* eslint-enable camelcase */
