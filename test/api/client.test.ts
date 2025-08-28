/* eslint-disable camelcase */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { Client } from '../../core/api/client'

interface ClientWithPrivate {
  makeRequest: ReturnType<typeof vi.fn>
  token: undefined | string
}

vi.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response)

describe('client', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let originalEnvironment: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    originalEnvironment = { ...process.env }
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    process.env = originalEnvironment
  })

  describe('constructor', () => {
    it('should create client with provided token', () => {
      let token = 'test-token-123'
      let client = new Client(token)

      expect(client).toBeInstanceOf(Client)
      expect((client as unknown as ClientWithPrivate).token).toBe(token)
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should create client with GITHUB_TOKEN from env', () => {
      let environmentToken = 'env-token-456'
      process.env['GITHUB_TOKEN'] = environmentToken

      let client = new Client()
      expect(client).toBeInstanceOf(Client)
      expect((client as unknown as ClientWithPrivate).token).toBe(
        environmentToken,
      )
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should warn when no token is available', () => {
      delete process.env['GITHUB_TOKEN']

      let client = new Client()
      expect(client).toBeInstanceOf(Client)
      expect((client as unknown as ClientWithPrivate).token).toBeUndefined()
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'No GitHub token found. API rate limits will be restricted.',
      )
    })
  })

  describe('getLatestRelease', () => {
    it('should fetch and return latest release', async () => {
      let client = new Client('test-token')
      let mockRelease = {
        html_url: 'https://github.com/owner/repo/releases/v1.0.0',
        body: 'This is the release description',
        published_at: '2023-01-15T10:00:00Z',
        target_commitish: 'abc123',
        name: 'Release v1.0.0',
        tag_name: 'v1.0.0',
        prerelease: false,
      }

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if (url === 'https://api.github.com/repos/owner/repo/releases/latest') {
          return Promise.resolve(
            new Response(JSON.stringify(mockRelease), {
              headers: {
                'x-ratelimit-reset': '1234567890',
                'x-ratelimit-remaining': '4999',
              },
              status: 200,
            }),
          )
        }
        if (
          url === 'https://api.github.com/repos/owner/repo/releases/tags/v1.0.0'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify(mockRelease), {
              status: 200,
              headers: {},
            }),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getLatestRelease('owner', 'repo')

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/releases/v1.0.0',
        description: 'This is the release description',
        publishedAt: new Date('2023-01-15T10:00:00Z'),
        name: 'Release v1.0.0',
        isPrerelease: false,
        version: 'v1.0.0',
        sha: 'abc123',
      })
    })

    it('should return null when no release found', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('Not Found', {
          statusText: 'Not Found',
          status: 404,
        }),
      )

      let result = await client.getLatestRelease('owner', 'repo')
      expect(result).toBeNull()
    })

    it('should handle releases without tagCommit', async () => {
      let client = new Client('test-token')
      let mockRelease = {
        html_url: 'https://github.com/owner/repo/releases/v1.0.0',
        published_at: '2023-01-15T10:00:00Z',
        name: 'Release v1.0.0',
        target_commitish: null,
        tag_name: 'v1.0.0',
        prerelease: false,
        body: null,
      }

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify(mockRelease), {
          status: 200,
          headers: {},
        }),
      )

      let result = await client.getLatestRelease('owner', 'repo')

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/releases/v1.0.0',
        publishedAt: new Date('2023-01-15T10:00:00Z'),
        name: 'Release v1.0.0',
        isPrerelease: false,
        description: null,
        version: 'v1.0.0',
        sha: null,
      })
    })

    it('should throw GitHubRateLimitError when rate limit exceeded', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('API rate limit exceeded', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should fallback name to tagName when name is null', async () => {
      let client = new Client('test-token')

      let tagInfoSpy = vi
        .spyOn(
          (Client as unknown as { prototype: Client }).prototype,
          'getTagInfo',
        )
        .mockResolvedValue(null)

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo/releases/v2.3.4',
            published_at: '2023-02-01T00:00:00Z',
            target_commitish: null,
            tag_name: 'v2.3.4',
            prerelease: false,
            body: 'desc',
            name: null,
          }),
          {
            status: 200,
            headers: {},
          },
        ),
      )

      let result = await client.getLatestRelease('owner', 'repo')
      expect(result).toMatchObject({ name: 'v2.3.4' })

      tagInfoSpy.mockRestore()
    })
  })

  describe('getAllReleases', () => {
    it('should fetch and return multiple releases', async () => {
      let client = new Client('test-token')
      let mockReleases = [
        {
          html_url: 'https://github.com/owner/repo/releases/v1.0.0',
          published_at: '2023-01-15T10:00:00Z',
          target_commitish: 'abc123',
          name: 'Release v1.0.0',
          body: 'Description 1',
          tag_name: 'v1.0.0',
          prerelease: false,
        },
        {
          html_url: 'https://github.com/owner/repo/releases/v0.9.0',
          published_at: '2023-01-10T10:00:00Z',
          target_commitish: 'def456',
          name: 'Release v0.9.0',
          body: 'Description 2',
          tag_name: 'v0.9.0',
          prerelease: true,
        },
      ]

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if (
          url === 'https://api.github.com/repos/owner/repo/releases?per_page=5'
        ) {
          return Promise.resolve(
            new Response(JSON.stringify(mockReleases), {
              status: 200,
              headers: {},
            }),
          )
        }
        if ((url as string).includes('/releases/tags/')) {
          let [, tag] = (url as string).split('/releases/tags/')
          let release = mockReleases.find(
            currentRelease => currentRelease.tag_name === tag,
          )
          return Promise.resolve(
            new Response(JSON.stringify(release), {
              status: 200,
              headers: {},
            }),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getAllReleases('owner', 'repo', 5)

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/releases?per_page=5',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'application/vnd.github.v3+json',
            Authorization: 'Bearer test-token',
            'User-Agent': 'actions-up',
          }) as unknown,
        }),
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        url: 'https://github.com/owner/repo/releases/v1.0.0',
        publishedAt: new Date('2023-01-15T10:00:00Z'),
        description: 'Description 1',
        name: 'Release v1.0.0',
        isPrerelease: false,
        version: 'v1.0.0',
        sha: 'abc123',
      })
    })

    it('should return empty array when no releases found', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('[]', {
          status: 200,
          headers: {},
        }),
      )

      let result = await client.getAllReleases('owner', 'repo')
      expect(result).toEqual([])
    })

    it('should use default limit of 10', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('[]', {
          status: 200,
          headers: {},
        }),
      )

      await client.getAllReleases('owner', 'repo')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/owner/repo/releases?per_page=10',
        expect.any(Object),
      )
    })

    it('should throw GitHubRateLimitError when rate limit exceeded', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('API rate limit exceeded', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should propagate non-rate-limit errors', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockRejectedValue(
        new Error('Network failure'),
      )

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        'Network failure',
      )
    })

    it('should handle releases with missing tagCommit', async () => {
      let client = new Client('test-token')
      let mockRelease = {
        html_url: 'https://github.com/owner/repo/releases/v1.0.0',
        published_at: '2023-01-15T10:00:00Z',
        name: 'Release v1.0.0',
        target_commitish: null,
        body: 'Description',
        tag_name: 'v1.0.0',
        prerelease: false,
      }

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify([mockRelease]), {
          status: 200,
          headers: {},
        }),
      )

      let result = await client.getAllReleases('owner', 'repo')

      expect(result[0]).toMatchObject({
        sha: null,
      })
    })

    it('should handle releases with null description', async () => {
      let client = new Client('test-token')
      let mockRelease = {
        html_url: 'https://github.com/owner/repo/releases/v1.0.0',
        published_at: '2023-01-15T10:00:00Z',
        target_commitish: 'abc123',
        name: 'Release v1.0.0',
        tag_name: 'v1.0.0',
        prerelease: false,
        body: null,
      }

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases?')) {
          return Promise.resolve(
            new Response(JSON.stringify([mockRelease]), {
              status: 200,
              headers: {},
            }),
          )
        }
        if ((url as string).includes('/releases/tags/')) {
          return Promise.resolve(
            new Response(JSON.stringify(mockRelease), {
              status: 200,
              headers: {},
            }),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getAllReleases('owner', 'repo')

      expect(result[0]).toMatchObject({
        description: null,
      })
    })

    it('should handle releases with null name (fallback to tagName)', async () => {
      let client = new Client('test-token')
      let mockRelease = {
        html_url: 'https://github.com/owner/repo/releases/v1.0.0',
        published_at: '2023-01-15T10:00:00Z',
        target_commitish: 'abc123',
        body: 'Description',
        tag_name: 'v1.0.0',
        prerelease: false,
        name: null,
      }

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases?')) {
          return Promise.resolve(
            new Response(JSON.stringify([mockRelease]), {
              status: 200,
              headers: {},
            }),
          )
        }
        if ((url as string).includes('/releases/tags/')) {
          return Promise.resolve(
            new Response(JSON.stringify(mockRelease), {
              status: 200,
              headers: {},
            }),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getAllReleases('owner', 'repo')

      expect(result[0]).toMatchObject({
        name: 'v1.0.0',
      })
    })
  })

  describe('getTagInfo', () => {
    it('should return tag info when fetched directly by release tag (with published_at)', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.2.3')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                html_url: 'https://github.com/owner/repo/releases/v1.2.3',
                published_at: '2024-01-20T10:00:00Z',
                target_commitish: 'commitish-123',
                body: 'Release body',
                tag_name: 'v1.2.3',
                prerelease: false,
                name: 'Rel',
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/commits/commitish-123')) {
          return Promise.resolve(
            new Response(JSON.stringify({ sha: 'commit-sha-xyz' }), {
              status: 200,
            }),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.2.3')

      expect(result).toEqual({
        date: new Date('2024-01-20T10:00:00Z'),
        message: 'Release body',
        sha: 'commit-sha-xyz',
        tag: 'v1.2.3',
      })
    })

    it('should handle release-by-tag with null published_at (date null)', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo/releases/v0.0.1',
            target_commitish: 'main',
            published_at: null,
            tag_name: 'v0.0.1',
            prerelease: false,
            body: null,
            name: null,
          }),
          { status: 200, headers: {} },
        ),
      )

      let result = await client.getTagInfo('owner', 'repo', 'v0.0.1')

      expect(result).toEqual({
        message: null,
        tag: 'v0.0.1',
        sha: 'main',
        date: null,
      })
    })

    it('should fetch tag information for annotated tag', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.0')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.0')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'tag-sha-123',
                  type: 'tag',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/tags/tag-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                tagger: { date: '2023-01-15T10:00:00Z' },
                object: { sha: 'commit-sha-456' },
                message: 'Tag message',
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.0')

      expect(result).toEqual({
        date: new Date('2023-01-15T10:00:00Z'),
        message: 'Tag message',
        sha: 'commit-sha-456',
        tag: 'v1.0.0',
      })
    })

    it('should fetch tag information for lightweight tag (commit)', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.1')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.1')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'commit-sha-123',
                  type: 'commit',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/commits/commit-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                author: { date: '2023-01-10T10:00:00Z' },
                message: 'Commit message',
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.1')

      expect(result).toEqual({
        date: new Date('2023-01-10T10:00:00Z'),
        message: 'Commit message',
        sha: 'commit-sha-123',
        tag: 'v1.0.1',
      })
    })

    it('should handle refs/tags/ prefix', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.0')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.0')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'commit-sha-123',
                  type: 'commit',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/commits/commit-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                author: { date: null },
                message: 'Message',
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }))
      })

      await client.getTagInfo('owner', 'repo', 'refs/tags/v1.0.0')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/releases/tags/v1.0.0'),
        expect.any(Object),
      )
    })

    it('should return null when tag not found', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('Not Found', {
          statusText: 'Not Found',
          status: 404,
        }),
      )

      let result = await client.getTagInfo('owner', 'repo', 'nonexistent')
      expect(result).toBeNull()
    })

    it('should handle commit without message', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.3')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.3')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'commit-sha-123',
                  type: 'commit',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/commits/commit-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                author: { date: '2023-01-10T10:00:00Z' },
                message: null,
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.3')

      expect(result).toMatchObject({
        message: null,
      })
    })

    it('should handle annotated tag without target', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.2')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.2')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'tag-sha-123',
                  type: 'tag',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/tags/tag-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                tagger: { date: '2023-01-15T10:00:00Z' },
                message: 'Tag message',
                object: { sha: null },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.2')

      expect(result).toMatchObject({
        sha: null,
      })
    })

    it('should handle commit with null committedDate', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.3')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.3')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'commit-sha-123',
                  type: 'commit',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/commits/commit-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                message: 'Commit message',
                author: { date: null },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.3')

      expect(result).toMatchObject({
        date: null,
      })
    })

    it('should handle tag with null tagger date', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.4')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.4')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'tag-sha-123',
                  type: 'tag',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/tags/tag-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: { sha: 'commit-sha-456' },
                message: 'Tag message',
                tagger: { date: null },
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.4')

      expect(result).toMatchObject({
        date: null,
      })
    })

    it('should handle tag with null message', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.5')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.5')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'tag-sha-123',
                  type: 'tag',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/tags/tag-sha-123')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                tagger: { date: '2023-01-15T10:00:00Z' },
                object: { sha: 'commit-sha-456' },
                message: null,
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.5')

      expect(result).toMatchObject({
        message: null,
      })
    })

    it('should tolerate commit details fetch failure and keep nulls', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.0.6')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.0.6')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: {
                  sha: 'commit-sha-fail',
                  type: 'commit',
                },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/commits/commit-sha-fail')) {
          return Promise.reject(new Error('commit fetch failed'))
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.6')

      expect(result).toEqual({
        sha: 'commit-sha-fail',
        tag: 'v1.0.6',
        message: null,
        date: null,
      })
    })

    it('should throw GitHubRateLimitError when rate limit exceeded', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('API rate limit exceeded', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(
        client.getTagInfo('owner', 'repo', 'v1.0.0'),
      ).rejects.toThrow('GitHub API rate limit exceeded')
    })

    it('should propagate non-rate-limit errors', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockRejectedValue(
        new Error('Some other error'),
      )

      await expect(
        client.getTagInfo('owner', 'repo', 'v1.0.0'),
      ).rejects.toThrow('Some other error')
    })

    it('should tolerate failure to fetch annotated tag details and fall back to ref sha', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockImplementation(url => {
        if ((url as string).includes('/releases/tags/v1.2.0')) {
          return Promise.resolve(
            new Response('Not Found', {
              statusText: 'Not Found',
              status: 404,
            }),
          )
        }
        if ((url as string).includes('/git/refs/tags/v1.2.0')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                object: { sha: 'tag-sha-fallback', type: 'tag' },
              }),
              { status: 200, headers: {} },
            ),
          )
        }
        if ((url as string).includes('/git/tags/tag-sha-fallback')) {
          return Promise.reject(new Error('temporary failure'))
        }
        return Promise.reject(new Error('Unexpected URL'))
      })

      let result = await client.getTagInfo('owner', 'repo', 'v1.2.0')

      expect(result).toEqual({
        sha: 'tag-sha-fallback',
        tag: 'v1.2.0',
        message: null,
        date: null,
      })
    })

    it('should handle release-by-tag with null target_commitish and set sha to null', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo/releases/v9.9.9',
            published_at: '2024-02-02T10:00:00Z',
            target_commitish: null,
            tag_name: 'v9.9.9',
            prerelease: false,
            body: null,
            name: null,
          }),
          { status: 200, headers: {} },
        ),
      )

      let result = await client.getTagInfo('owner', 'repo', 'v9.9.9')
      expect(result).toEqual({
        date: new Date('2024-02-02T10:00:00Z'),
        message: null,
        tag: 'v9.9.9',
        sha: null,
      })
    })
  })

  describe('getRateLimitStatus', () => {
    it('should return current rate limit status', () => {
      let client = new Client('test-token')

      let result = client.getRateLimitStatus()

      expect(result).toHaveProperty('remaining')
      expect(result).toHaveProperty('resetAt')
      expect(result.resetAt).toBeInstanceOf(Date)
    })

    it('should update rate limit after API call', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo',
            published_at: '2023-01-15T10:00:00Z',
            target_commitish: null,
            tag_name: 'v1.0.0',
            prerelease: false,
            name: 'Release',
            body: null,
          }),
          {
            headers: {
              'x-ratelimit-reset': '1700000000',
              'x-ratelimit-remaining': '4950',
            },
            status: 200,
          },
        ),
      )

      await client.getLatestRelease('owner', 'repo')

      let result = client.getRateLimitStatus()
      expect(result.remaining).toBe(4950)
      expect(result.resetAt).toEqual(new Date(1700000000 * 1000))
    })

    it('should parse numeric rate limit headers correctly', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo',
            published_at: '2023-01-15T10:00:00Z',
            target_commitish: null,
            tag_name: 'v1.0.0',
            prerelease: false,
            name: 'Release',
            body: null,
          }),
          {
            headers: {
              'x-ratelimit-reset': '1700000002',
              'x-ratelimit-remaining': '1234',
            },
            status: 200,
          },
        ),
      )

      await client.getLatestRelease('owner', 'repo')

      let status = client.getRateLimitStatus()
      expect(status.remaining).toBe(1234)
      expect(status.resetAt).toEqual(new Date(1700000002 * 1000))
    })

    it('should update from numeric header values directly', () => {
      let client = new Client('test-token')

      ;(
        client as unknown as {
          updateRateLimitInfo(
            headers: Record<string, undefined | string | number>,
          ): void
        }
      ).updateRateLimitInfo({
        'x-ratelimit-reset': 1700000003,
        'x-ratelimit-remaining': 42,
      })

      let status = client.getRateLimitStatus()
      expect(status.remaining).toBe(42)
      expect(status.resetAt).toEqual(new Date(1700000003 * 1000))
    })
  })

  describe('shouldWaitForRateLimit', () => {
    it('should return true when below threshold', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo',
            published_at: '2023-01-15T10:00:00Z',
            target_commitish: null,
            tag_name: 'v1.0.0',
            prerelease: false,
            name: 'Release',
            body: null,
          }),
          {
            headers: {
              'x-ratelimit-reset': '1700000000',
              'x-ratelimit-remaining': '50',
            },
            status: 200,
          },
        ),
      )

      await client.getLatestRelease('owner', 'repo')

      expect(client.shouldWaitForRateLimit(100)).toBeTruthy()
      expect(client.shouldWaitForRateLimit(40)).toBeFalsy()
    })

    it('should use default threshold of 100', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo',
            published_at: '2023-01-15T10:00:00Z',
            target_commitish: null,
            tag_name: 'v1.0.0',
            prerelease: false,
            name: 'Release',
            body: null,
          }),
          {
            headers: {
              'x-ratelimit-reset': '1700000000',
              'x-ratelimit-remaining': '50',
            },
            status: 200,
          },
        ),
      )

      await client.getLatestRelease('owner', 'repo')

      expect(client.shouldWaitForRateLimit()).toBeTruthy()
    })
  })

  describe('error handling', () => {
    it('should propagate non-rate-limit errors', async () => {
      let client = new Client('test-token')
      let error = new Error('Network error')

      vi.mocked(globalThis.fetch).mockRejectedValue(error)

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'Network error',
      )
    })

    it('should handle rate limit errors consistently across methods', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('rate limit', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })
  })

  describe('rate limit handling', () => {
    it('should detect error with rate limit message', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('API rate limit exceeded', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should detect error with status 403', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('Forbidden', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should handle non-string error.message with status 403', async () => {
      let client = new Client('test-token')

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('12345', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should handle non-string error.message without 403 safely', async () => {
      let client = new Client('test-token')

      let thrown = { message: 12345, status: 400 } as unknown
      vi.mocked(globalThis.fetch).mockRejectedValue(thrown)

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toBe(
        thrown,
      )
    })

    it('should work without token but show warning', () => {
      delete process.env['GITHUB_TOKEN']

      let client = new Client()

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'No GitHub token found. API rate limits will be restricted.',
      )
      expect(client.getRateLimitStatus().remaining).toBe(60)
    })

    it('should create client without token and still make requests', async () => {
      delete process.env['GITHUB_TOKEN']
      let client = new Client()

      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            published_at: '2023-01-15T10:00:00Z',
            html_url: 'https://github.com',
            target_commitish: 'main',
            tag_name: 'v1.0.0',
            prerelease: false,
            name: 'Release',
            body: 'Body',
          }),
          { status: 200, headers: {} },
        ),
      )

      let result = await client.getTagInfo('owner', 'repo', 'v1.0.0')

      expect(result).toEqual({
        date: new Date('2023-01-15T10:00:00Z'),
        message: 'Body',
        tag: 'v1.0.0',
        sha: 'main',
      })
    })

    it('should use correct reset time in GitHubRateLimitError', async () => {
      let client = new Client('test-token')
      let resetEpoch = Math.floor(
        new Date('2024-01-01T12:00:00Z').getTime() / 1000,
      )

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/owner/repo',
            published_at: '2023-01-15T10:00:00Z',
            target_commitish: null,
            tag_name: 'v1.0.0',
            prerelease: false,
            name: 'Release',
            body: null,
          }),
          {
            headers: {
              'x-ratelimit-reset': String(resetEpoch),
              'x-ratelimit-remaining': '4950',
            },
            status: 200,
          },
        ),
      )

      await client.getLatestRelease('owner', 'repo')

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response('rate limit', {
          statusText: 'Forbidden',
          status: 403,
        }),
      )

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })
  })
})

/* eslint-enable camelcase */
