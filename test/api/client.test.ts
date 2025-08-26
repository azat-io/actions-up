import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { GraphqlResponseError, graphql } from '@octokit/graphql'

import { Client } from '../../core/api/client'

type OctokitGraphqlModuleLike = {
  GraphqlResponseError: typeof GraphqlResponseError
  graphql: GraphqlType
} & Record<string, unknown>

type GraphqlType = typeof graphql

function createGraphqlMock(
  impl?: (...arguments_: Parameters<GraphqlType>) => ReturnType<GraphqlType>,
): GraphqlType {
  let core = impl ? vi.fn(impl) : vi.fn()
  let graphqlMock = {} as GraphqlType
  let defaults: GraphqlType['defaults'] = vi.fn(() => graphqlMock)
  let endpoint: GraphqlType['endpoint'] = {} as GraphqlType['endpoint']
  graphqlMock = Object.assign(core, {
    defaults,
    endpoint,
  }) as unknown as GraphqlType
  return graphqlMock
}

vi.mock('@octokit/graphql', async importOriginal => {
  let actualUnknown = await importOriginal()
  let actual = actualUnknown as OctokitGraphqlModuleLike
  let mockGraphql = createGraphqlMock()
  class TestGraphqlResponseError extends Error {
    public errors: { message?: string; type?: string }[]
    public constructor(
      message: string,
      errors: { message?: string; type?: string }[],
    ) {
      super(message)
      this.name = 'TestGraphqlResponseError'
      this.errors = errors
    }
  }
  let mockedModule: OctokitGraphqlModuleLike = {
    ...actual,
    GraphqlResponseError:
      TestGraphqlResponseError as unknown as typeof GraphqlResponseError,
    graphql: mockGraphql,
  }
  return mockedModule
})

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
      let mockGraphqlWithAuth = createGraphqlMock()
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client(token)
      expect(client).toBeInstanceOf(Client)

      expect(graphql.defaults).toHaveBeenCalledWith({
        headers: {
          authorization: `token ${token}`,
        },
      })
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should create client with GITHUB_TOKEN from env', () => {
      let environmentToken = 'env-token-456'
      process.env['GITHUB_TOKEN'] = environmentToken
      let mockGraphqlWithAuth = createGraphqlMock()
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client()
      expect(client).toBeInstanceOf(Client)

      expect(graphql.defaults).toHaveBeenCalledWith({
        headers: {
          authorization: `token ${environmentToken}`,
        },
      })
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('should warn when no token is available', () => {
      delete process.env['GITHUB_TOKEN']
      let mockGraphqlWithAuth = createGraphqlMock()
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client()
      expect(client).toBeInstanceOf(Client)

      expect(graphql.defaults).toHaveBeenCalledWith({
        headers: {},
      })
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No GitHub token found'),
      )
    })
  })

  describe('getLatestRelease', () => {
    it('should fetch and return latest release', async () => {
      let mockResponse = {
        repository: {
          latestRelease: {
            url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
            publishedAt: '2024-01-01T00:00:00Z',
            tagCommit: { oid: 'abc123' },
            description: 'Test release',
            name: 'Release 1.2.3',
            isPrerelease: false,
            tagName: 'v1.2.3',
          },
          defaultBranchRef: {
            target: { oid: 'def456' },
            name: 'main',
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4999,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getLatestRelease('owner', 'repo')

      expect(mockGraphqlWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('query getLatestRelease'),
        { owner: 'owner', repo: 'repo' },
      )

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
        publishedAt: new Date('2024-01-01T00:00:00Z'),
        description: 'Test release',
        name: 'Release 1.2.3',
        isPrerelease: false,
        version: 'v1.2.3',
        sha: 'abc123',
      })
    })

    it('should return null when no release found', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4998,
        },
        repository: {
          defaultBranchRef: null,
          latestRelease: null,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getLatestRelease('owner', 'repo')

      expect(result).toBeNull()
    })

    it('should handle releases without tagCommit', async () => {
      let mockResponse = {
        repository: {
          latestRelease: {
            url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
            publishedAt: '2024-01-01T00:00:00Z',
            isPrerelease: true,
            tagName: 'v1.0.0',
            description: null,
            tagCommit: null,
            name: null,
          },
          defaultBranchRef: null,
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4997,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getLatestRelease('owner', 'repo')

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
        publishedAt: new Date('2024-01-01T00:00:00Z'),
        isPrerelease: true,
        description: null,
        version: 'v1.0.0',
        name: 'v1.0.0',
        sha: null,
      })
    })

    it('should throw GitHubRateLimitError when rate limit exceeded', async () => {
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(new Error('API rate limit exceeded')),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })
  })

  describe('getAllReleases', () => {
    it('should fetch and return multiple releases', async () => {
      let mockResponse = {
        repository: {
          releases: {
            nodes: [
              {
                url: 'https://github.com/owner/repo/releases/tag/v2.0.0',
                publishedAt: '2024-01-02T00:00:00Z',
                tagCommit: { oid: 'xyz789' },
                description: 'Major release',
                name: 'Version 2.0',
                isPrerelease: false,
                tagName: 'v2.0.0',
              },
              {
                url: 'https://github.com/owner/repo/releases/tag/v1.9.0',
                publishedAt: '2024-01-01T00:00:00Z',
                tagCommit: { oid: 'uvw456' },
                description: 'Minor release',
                name: 'Version 1.9',
                isPrerelease: false,
                tagName: 'v1.9.0',
              },
            ],
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4996,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getAllReleases('owner', 'repo', 5)

      expect(mockGraphqlWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('query getAllReleases'),
        { owner: 'owner', repo: 'repo', limit: 5 },
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        url: 'https://github.com/owner/repo/releases/tag/v2.0.0',
        publishedAt: new Date('2024-01-02T00:00:00Z'),
        description: 'Major release',
        name: 'Version 2.0',
        isPrerelease: false,
        version: 'v2.0.0',
        sha: 'xyz789',
      })
    })

    it('should return empty array when no releases found', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4995,
        },
        repository: {
          releases: null,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getAllReleases('owner', 'repo')

      expect(result).toEqual([])
    })

    it('should use default limit of 10', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4994,
        },
        repository: { releases: { nodes: [] } },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      await client.getAllReleases('owner', 'repo')

      expect(mockGraphqlWithAuth).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 10 }),
      )
    })

    it('should throw GitHubRateLimitError when rate limit exceeded', async () => {
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(new Error('API rate limit exceeded')),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should propagate non-rate-limit errors', async () => {
      let genericError = new Error('Network failure')
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(genericError),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        'Network failure',
      )
    })

    it('should handle releases with missing tagCommit', async () => {
      let mockResponse = {
        repository: {
          releases: {
            nodes: [
              {
                url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
                publishedAt: '2024-01-01T00:00:00Z',
                description: 'Release description',
                name: 'Release 1.0.0',
                tagCommit: undefined,
                isPrerelease: false,
                tagName: 'v1.0.0',
              },
            ],
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4989,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getAllReleases('owner', 'repo')

      expect(result).toEqual([
        {
          url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
          publishedAt: new Date('2024-01-01T00:00:00Z'),
          description: 'Release description',
          name: 'Release 1.0.0',
          isPrerelease: false,
          version: 'v1.0.0',
          sha: null,
        },
      ])
    })

    it('should handle releases with null description', async () => {
      let mockResponse = {
        repository: {
          releases: {
            nodes: [
              {
                url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
                publishedAt: '2024-01-01T00:00:00Z',
                tagCommit: { oid: 'abc123' },
                name: 'Release 1.0.0',
                isPrerelease: false,
                description: null,
                tagName: 'v1.0.0',
              },
            ],
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4989,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getAllReleases('owner', 'repo')

      expect(result).toEqual([
        {
          url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
          publishedAt: new Date('2024-01-01T00:00:00Z'),
          name: 'Release 1.0.0',
          isPrerelease: false,
          description: null,
          version: 'v1.0.0',
          sha: 'abc123',
        },
      ])
    })

    it('should handle releases with null name (fallback to tagName)', async () => {
      let mockResponse = {
        repository: {
          releases: {
            nodes: [
              {
                url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
                publishedAt: '2024-01-01T00:00:00Z',
                description: 'Release description',
                tagCommit: { oid: 'abc123' },
                isPrerelease: false,
                tagName: 'v1.0.0',
                name: null,
              },
            ],
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4989,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getAllReleases('owner', 'repo')

      expect(result).toEqual([
        {
          url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
          publishedAt: new Date('2024-01-01T00:00:00Z'),
          description: 'Release description',
          isPrerelease: false,
          version: 'v1.0.0',
          name: 'v1.0.0',
          sha: 'abc123',
        },
      ])
    })
  })

  describe('getTagInfo', () => {
    it('should fetch tag information for annotated tag', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              tagger: {
                date: '2024-01-01T00:00:00Z',
                email: 'john@example.com',
                name: 'John Doe',
              },
              target: {
                oid: 'commit456',
              },
              message: 'Release v1.0.0',
              oid: 'tag123',
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4993,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.0')

      expect(mockGraphqlWithAuth).toHaveBeenCalledWith(
        expect.stringContaining('query getTagInfo'),
        { tag: 'refs/tags/v1.0.0', owner: 'owner', repo: 'repo' },
      )

      expect(result).toEqual({
        date: new Date('2024-01-01T00:00:00Z'),
        message: 'Release v1.0.0',
        sha: 'commit456',
        tag: 'v1.0.0',
      })
    })

    it('should fetch tag information for lightweight tag (commit)', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              author: {
                email: 'jane@example.com',
                name: 'Jane Doe',
              },
              committedDate: '2024-01-01T12:00:00Z',
              message: 'Fix: important bug',
              oid: 'commit789',
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4992,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.1')

      expect(result).toEqual({
        date: new Date('2024-01-01T12:00:00Z'),
        message: 'Fix: important bug',
        sha: 'commit789',
        tag: 'v1.0.1',
      })
    })

    it('should handle refs/tags/ prefix', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4991,
        },
        repository: { ref: null },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      await client.getTagInfo('owner', 'repo', 'refs/tags/v1.0.0')

      expect(mockGraphqlWithAuth).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ tag: 'refs/tags/v1.0.0' }),
      )
    })

    it('should return null when tag not found', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4990,
        },
        repository: { ref: null },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'nonexistent')

      expect(result).toBeNull()
    })

    it('should handle commit without message', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              author: {
                email: 'test@example.com',
                name: 'Test User',
              },
              committedDate: '2024-01-01T12:00:00Z',
              oid: 'commit123',
              message: null,
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4988,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.3')

      expect(result).toEqual({
        date: new Date('2024-01-01T12:00:00Z'),
        sha: 'commit123',
        message: null,
        tag: 'v1.0.3',
      })
    })

    it('should handle annotated tag without target', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              tagger: {
                date: '2024-01-01T00:00:00Z',
                email: 'john@example.com',
                name: 'John Doe',
              },
              message: 'Tag without target',
              oid: 'tag456',
              target: null,
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4989,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.2')

      expect(result).toEqual({
        date: new Date('2024-01-01T00:00:00Z'),
        message: 'Tag without target',
        sha: 'tag456',
        tag: 'v1.0.2',
      })
    })

    it('should handle commit with null committedDate', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              author: {
                email: 'user@example.com',
                name: 'User',
              },
              message: 'Commit without date',
              committedDate: null,
              oid: 'commit999',
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4988,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.3')

      expect(result).toEqual({
        message: 'Commit without date',
        sha: 'commit999',
        tag: 'v1.0.3',
        date: null,
      })
    })

    it('should handle tag with null tagger date', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              tagger: {
                email: 'john@example.com',
                name: 'John Doe',
                date: null,
              },
              target: {
                oid: 'commit888',
              },
              message: 'Tag without date',
              oid: 'tag777',
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4987,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.4')

      expect(result).toEqual({
        message: 'Tag without date',
        sha: 'commit888',
        tag: 'v1.0.4',
        date: null,
      })
    })

    it('should handle tag with null message', async () => {
      let mockResponse = {
        repository: {
          ref: {
            target: {
              tagger: {
                date: '2024-01-01T00:00:00Z',
                email: 'john@example.com',
                name: 'John Doe',
              },
              target: {
                oid: 'commit777',
              },
              message: null,
              oid: 'tag666',
            },
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 4986,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let result = await client.getTagInfo('owner', 'repo', 'v1.0.5')

      expect(result).toEqual({
        date: new Date('2024-01-01T00:00:00Z'),
        sha: 'commit777',
        message: null,
        tag: 'v1.0.5',
      })
    })

    it('should throw GitHubRateLimitError when rate limit exceeded', async () => {
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(new Error('API rate limit exceeded')),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(
        client.getTagInfo('owner', 'repo', 'v1.0.0'),
      ).rejects.toThrow('GitHub API rate limit exceeded')
    })

    it('should propagate non-rate-limit errors', async () => {
      let genericError = new Error('Some other error')
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(genericError),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(
        client.getTagInfo('owner', 'repo', 'v1.0.0'),
      ).rejects.toThrow('Some other error')
    })
  })

  describe('getRateLimitStatus', () => {
    it('should return current rate limit status', () => {
      let mockGraphqlWithAuth = createGraphqlMock()
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      let status = client.getRateLimitStatus()

      expect(status.remaining).toBe(5000)
      expect(status.resetAt).toBeInstanceOf(Date)
    })

    it('should update rate limit after API call', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T02:00:00Z',
          remaining: 4989,
        },
        repository: { latestRelease: null },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      await client.getLatestRelease('owner', 'repo')

      let status = client.getRateLimitStatus()
      expect(status).toEqual({
        resetAt: new Date('2024-01-01T02:00:00Z'),
        remaining: 4989,
      })
    })
  })

  describe('shouldWaitForRateLimit', () => {
    it('should return true when below threshold', async () => {
      let mockResponse = {
        rateLimit: {
          resetAt: '2024-01-01T02:00:00Z',
          remaining: 50,
        },
        repository: { latestRelease: null },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      await client.getLatestRelease('owner', 'repo')

      expect(client.shouldWaitForRateLimit(100)).toBeTruthy()
      expect(client.shouldWaitForRateLimit(50)).toBeFalsy()
      expect(client.shouldWaitForRateLimit(25)).toBeFalsy()
    })

    it('should use default threshold of 100', () => {
      let mockGraphqlWithAuth = createGraphqlMock()
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      expect(client.shouldWaitForRateLimit()).toBeFalsy()
    })
  })

  describe('error handling', () => {
    it('should propagate non-rate-limit errors', async () => {
      let networkError = new Error('Network error')
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(networkError),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'Network error',
      )
    })

    it('should handle rate limit errors consistently across methods', async () => {
      let rateLimitError = new Error('API rate limit exceeded')
      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(rateLimitError),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )

      await expect(
        client.getTagInfo('owner', 'repo', 'v1.0.0'),
      ).rejects.toThrow('GitHub API rate limit exceeded')
    })
  })

  describe('rate limit handling', () => {
    it('should detect GraphqlResponseError with RATE_LIMITED type', async () => {
      type GraphqlErrorCtor = new (
        message: string,
        errors: { message?: string; type?: string }[],
      ) => Error
      let GraphqlError = GraphqlResponseError as unknown as GraphqlErrorCtor
      let rateLimitError = new GraphqlError('rate limited', [
        { type: 'RATE_LIMITED' },
      ])

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(rateLimitError),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getLatestRelease('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should detect GraphqlResponseError with rate limit message', async () => {
      type GraphqlErrorCtor = new (
        message: string,
        errors: { message?: string; type?: string }[],
      ) => Error
      let GraphqlError = GraphqlResponseError as unknown as GraphqlErrorCtor
      let rateLimitError = new GraphqlError('error', [
        { message: 'You have exceeded a secondary rate limit' },
      ])

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.reject(rateLimitError),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        'GitHub API rate limit exceeded',
      )
    })

    it('should work without token but show warning', () => {
      delete process.env['GITHUB_TOKEN']
      let mockGraphqlWithAuth = createGraphqlMock()
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client()
      expect(client).toBeInstanceOf(Client)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No GitHub token found'),
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('API rate limits will be restricted'),
      )
    })

    it('should create client without token and still make requests', async () => {
      delete process.env['GITHUB_TOKEN']
      let mockResponse = {
        repository: {
          latestRelease: {
            url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
            publishedAt: '2024-01-01T00:00:00Z',
            tagCommit: { oid: 'abc123' },
            description: 'Test release',
            name: 'Release 1.0.0',
            isPrerelease: false,
            tagName: 'v1.0.0',
          },
        },
        rateLimit: {
          resetAt: '2024-01-01T01:00:00Z',
          remaining: 60,
        },
      }

      let mockGraphqlWithAuth = createGraphqlMock(() =>
        Promise.resolve(mockResponse),
      )
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client()

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No GitHub token found'),
      )

      let result = await client.getLatestRelease('owner', 'repo')

      expect(result).toEqual({
        url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
        publishedAt: new Date('2024-01-01T00:00:00Z'),
        description: 'Test release',
        name: 'Release 1.0.0',
        isPrerelease: false,
        version: 'v1.0.0',
        sha: 'abc123',
      })

      expect(client.getRateLimitStatus()).toEqual({
        resetAt: new Date('2024-01-01T01:00:00Z'),
        remaining: 60,
      })

      expect(client.shouldWaitForRateLimit()).toBeTruthy()
    })

    it('should use correct reset time in GitHubRateLimitError', async () => {
      let resetTime = new Date('2024-01-01T03:00:00Z')
      let mockResponse1 = {
        rateLimit: {
          resetAt: resetTime.toISOString(),
          remaining: 0,
        },
        repository: { latestRelease: null },
      }

      let callCount = 0
      let mockGraphqlWithAuth = createGraphqlMock(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(mockResponse1)
        }
        return Promise.reject(new Error('API rate limit exceeded'))
      })
      vi.mocked(graphql.defaults).mockReturnValue(mockGraphqlWithAuth)

      let client = new Client('test-token')
      await client.getLatestRelease('owner', 'repo')

      await expect(client.getAllReleases('owner', 'repo')).rejects.toThrow(
        `GitHub API rate limit exceeded. Resets at ${resetTime.toLocaleTimeString()}`,
      )
    })
  })
})
