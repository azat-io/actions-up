import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { GitHubAction } from '../../types/github-action'

import { checkUpdates } from '../../core/api/check-updates'
import { Client } from '../../core/api/client'

vi.mock('../../core/api/client')

describe('checkUpdates', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it('returns empty array when no actions provided', async () => {
    let result = await checkUpdates([])
    expect(result).toEqual([])
  })

  it('returns empty array when only local actions provided', async () => {
    let localActions: GitHubAction[] = [
      {
        name: './local-action',
        uses: './local-action',
        ref: './local-action',
        type: 'local',
        version: null,
      },
      {
        uses: 'docker://some-image:latest',
        ref: 'docker://some-image:latest',
        name: 'docker://some-image',
        version: 'latest',
        type: 'docker',
      },
    ]

    let result = await checkUpdates(localActions)
    expect(result).toEqual([])
  })

  it('checks updates for external actions', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/setup-node/releases/tag/v2.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'New release',
        name: 'Release v2.0.0',
        isPrerelease: false,
        version: 'v2.0.0',
        sha: 'abc123',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions, 'test-token')

    expect(Client).toHaveBeenCalledWith('test-token')
    expect(mockClient.getLatestRelease).toHaveBeenCalledWith(
      'actions',
      'setup-node',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!).toEqual({
      currentVersion: 'v1.0.0',
      latestVersion: 'v2.0.0',
      latestSha: 'abc123',
      action: actions[0],
      isBreaking: true,
      hasUpdate: true,
    })
  })

  it('handles rate limit errors gracefully', async () => {
    let rateLimitError = new Error('GitHub API rate limit exceeded')
    let mockClient = {
      getLatestRelease: vi.fn().mockRejectedValue(rateLimitError),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Failed to check actions/setup-node:',
      rateLimitError,
    )
    expect(result).toHaveLength(1)
    expect(result[0]!).toEqual({
      currentVersion: 'v1.0.0',
      latestVersion: null,
      action: actions[0],
      isBreaking: false,
      hasUpdate: false,
      latestSha: null,
    })
  })

  it('returns empty array for all actions when rate limit exceeded', async () => {
    let rateLimitError = new Error('GitHub API rate limit exceeded')
    let mockClient = {
      getLatestRelease: vi.fn().mockRejectedValue(rateLimitError),
      getAllReleases: vi.fn().mockRejectedValue(rateLimitError),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
      {
        uses: 'actions/checkout@v2.0.0',
        ref: 'actions/checkout@v2.0.0',
        name: 'actions/checkout',
        version: 'v2.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
    expect(result.every(update => update.latestVersion === null)).toBeTruthy()
    expect(result.every(update => !update.hasUpdate)).toBeTruthy()
  })

  it('falls back to getAllReleases when getLatestRelease returns null', async () => {
    let mockClient = {
      getAllReleases: vi.fn().mockResolvedValue([
        {
          url: 'https://github.com/actions/setup-node/releases/tag/v2.0.0-beta',
          publishedAt: new Date('2024-01-02'),
          description: 'Beta release',
          version: 'v2.0.0-beta',
          name: 'Beta v2.0.0',
          isPrerelease: true,
          sha: 'beta123',
        },
        {
          url: 'https://github.com/actions/setup-node/releases/tag/v1.5.0',
          publishedAt: new Date('2024-01-01'),
          description: 'Stable release',
          name: 'Release v1.5.0',
          isPrerelease: false,
          version: 'v1.5.0',
          sha: 'stable456',
        },
      ]),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getLatestRelease).toHaveBeenCalledWith(
      'actions',
      'setup-node',
    )
    expect(mockClient.getAllReleases).toHaveBeenCalledWith(
      'actions',
      'setup-node',
      10,
    )
    expect(result[0]!).toEqual({
      currentVersion: 'v1.0.0',
      latestVersion: 'v1.5.0',
      latestSha: 'stable456',
      action: actions[0],
      isBreaking: false,
      hasUpdate: true,
    })
  })

  it('fetches SHA when missing from release', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/setup-node/releases/tag/v2.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'New release',
        name: 'Release v2.0.0',
        isPrerelease: false,
        version: 'v2.0.0',
        sha: null,
      }),
      getTagInfo: vi.fn().mockResolvedValue({
        date: new Date('2024-01-01'),
        message: 'Release v2.0.0',
        sha: 'fetched789',
        tag: 'v2.0.0',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getTagInfo).toHaveBeenCalledWith(
      'actions',
      'setup-node',
      'v2.0.0',
    )
    expect(result[0]!.latestSha).toBe('fetched789')
  })

  it('handles SHA fetch errors gracefully', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/setup-node/releases/tag/v2.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'New release',
        name: 'Release v2.0.0',
        isPrerelease: false,
        version: 'v2.0.0',
        sha: null,
      }),
      getTagInfo: vi.fn().mockRejectedValue(new Error('Tag not found')),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getTagInfo).toHaveBeenCalledWith(
      'actions',
      'setup-node',
      'v2.0.0',
    )
    expect(result[0]!.latestSha).toBeNull()
  })

  it('deduplicates actions by name', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v3.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest',
        isPrerelease: false,
        version: 'v3.0.0',
        name: 'v3.0.0',
        sha: 'abc123',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@v2.0.0',
        ref: 'actions/checkout@v2.0.0',
        name: 'actions/checkout',
        version: 'v2.0.0',
        type: 'external',
      },
      {
        uses: 'actions/checkout@v2.0.0',
        ref: 'actions/checkout@v2.0.0',
        name: 'actions/checkout',
        version: 'v2.0.0',
        type: 'external',
      },
      {
        uses: 'actions/checkout@v1.0.0',
        ref: 'actions/checkout@v1.0.0',
        name: 'actions/checkout',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getLatestRelease).toHaveBeenCalledOnce()
    expect(mockClient.getLatestRelease).toHaveBeenCalledWith(
      'actions',
      'checkout',
    )
    expect(result).toHaveLength(3)
    expect(result[0]!.latestVersion).toBe('v3.0.0')
    expect(result[1]!.latestVersion).toBe('v3.0.0')
    expect(result[2]!.latestVersion).toBe('v3.0.0')
    expect(result[2]!.isBreaking).toBeTruthy()
  })

  it('handles invalid action names', async () => {
    let mockClient = {
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getLatestRelease: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'invalid-action-name@v1.0.0',
        ref: 'invalid-action-name@v1.0.0',
        name: 'invalid-action-name',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getLatestRelease).not.toHaveBeenCalled()
    expect(result).toHaveLength(1)
    expect(result[0]!).toEqual({
      currentVersion: 'v1.0.0',
      latestVersion: null,
      action: actions[0],
      isBreaking: false,
      hasUpdate: false,
      latestSha: null,
    })
  })

  it('detects breaking changes correctly', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v3.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Major release',
        isPrerelease: false,
        version: 'v3.0.0',
        name: 'v3.0.0',
        sha: 'abc123',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@v2.5.0',
        ref: 'actions/checkout@v2.5.0',
        name: 'actions/checkout',
        version: 'v2.5.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      currentVersion: 'v2.5.0',
      latestVersion: 'v3.0.0',
      latestSha: 'abc123',
      action: actions[0],
      isBreaking: true,
      hasUpdate: true,
    })
  })

  it('detects non-breaking updates correctly', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v2.6.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Minor release',
        isPrerelease: false,
        version: 'v2.6.0',
        name: 'v2.6.0',
        sha: 'abc123',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@v2.5.0',
        ref: 'actions/checkout@v2.5.0',
        name: 'actions/checkout',
        version: 'v2.5.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      currentVersion: 'v2.5.0',
      latestVersion: 'v2.6.0',
      latestSha: 'abc123',
      action: actions[0],
      isBreaking: false,
      hasUpdate: true,
    })
  })

  it('handles SHA versions', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v3.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest',
        isPrerelease: false,
        version: 'v3.0.0',
        name: 'v3.0.0',
        sha: 'def456',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@abc123def456789',
        ref: 'actions/checkout@abc123def456789',
        version: 'abc123def456789',
        name: 'actions/checkout',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      currentVersion: 'abc123def456789',
      latestVersion: 'v3.0.0',
      latestSha: 'def456',
      action: actions[0],
      isBreaking: false,
      hasUpdate: true,
    })
  })

  it('works without token', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/setup-node/releases/tag/v2.0.0',
        publishedAt: new Date('2024-01-01'),
        description: 'New release',
        name: 'Release v2.0.0',
        isPrerelease: false,
        version: 'v2.0.0',
        sha: 'abc123',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node@v1.0.0',
        ref: 'actions/setup-node@v1.0.0',
        name: 'actions/setup-node',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(Client).toHaveBeenCalledWith(undefined)
    expect(result).toHaveLength(1)
    expect(result[0]!.hasUpdate).toBeTruthy()
  })

  it('correctly identifies no update needed when SHA matches', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.0',
        sha: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest release',
        isPrerelease: false,
        version: 'v4.2.0',
        name: 'v4.2.0',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
        ref: 'actions/checkout@e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
        version: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
        name: 'actions/checkout',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      currentVersion: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
      latestSha: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
      latestVersion: 'v4.2.0',
      action: actions[0],
      isBreaking: false,
      hasUpdate: false,
    })
  })

  it('correctly identifies no update needed when short SHA matches', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.0',
        sha: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest release',
        isPrerelease: false,
        version: 'v4.2.0',
        name: 'v4.2.0',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@e2c02d0',
        ref: 'actions/checkout@e2c02d0',
        name: 'actions/checkout',
        version: 'e2c02d0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      latestSha: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
      currentVersion: 'e2c02d0',
      latestVersion: 'v4.2.0',
      action: actions[0],
      isBreaking: false,
      hasUpdate: false,
    })
  })

  it('correctly identifies update needed when SHA does not match', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.0',
        sha: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest release',
        isPrerelease: false,
        version: 'v4.2.0',
        name: 'v4.2.0',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@abc123def456789',
        ref: 'actions/checkout@abc123def456789',
        version: 'abc123def456789',
        name: 'actions/checkout',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      latestSha: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0',
      currentVersion: 'abc123def456789',
      latestVersion: 'v4.2.0',
      action: actions[0],
      isBreaking: false,
      hasUpdate: true,
    })
  })

  it('correctly handles SHA comparison with fetched SHA from tag info', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest release',
        isPrerelease: false,
        version: 'v4.2.0',
        name: 'v4.2.0',
        sha: null,
      }),
      getTagInfo: vi.fn().mockResolvedValue({
        date: new Date('2024-01-01'),
        sha: 'f1f2f3f4f5f6f7f8f9f0',
        message: 'Release v4.2.0',
        tag: 'v4.2.0',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@f1f2f3f',
        ref: 'actions/checkout@f1f2f3f',
        name: 'actions/checkout',
        version: 'f1f2f3f',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getTagInfo).toHaveBeenCalledWith(
      'actions',
      'checkout',
      'v4.2.0',
    )
    expect(result[0]!).toEqual({
      latestSha: 'f1f2f3f4f5f6f7f8f9f0',
      currentVersion: 'f1f2f3f',
      latestVersion: 'v4.2.0',
      action: actions[0],
      isBreaking: false,
      hasUpdate: false,
    })
  })

  it('correctly handles mixed case SHA comparison', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest release',
        sha: 'ABC123DEF456789',
        isPrerelease: false,
        version: 'v4.2.0',
        name: 'v4.2.0',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@abc123d',
        ref: 'actions/checkout@abc123d',
        name: 'actions/checkout',
        version: 'abc123d',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      latestSha: 'ABC123DEF456789',
      currentVersion: 'abc123d',
      latestVersion: 'v4.2.0',
      action: actions[0],
      isBreaking: false,
      hasUpdate: false,
    })
  })

  it('correctly identifies update needed when current is SHA but no latest SHA available', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        url: 'https://github.com/actions/checkout/releases/tag/v4.2.0',
        publishedAt: new Date('2024-01-01'),
        description: 'Latest release',
        isPrerelease: false,
        version: 'v4.2.0',
        name: 'v4.2.0',
        sha: null,
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getTagInfo: vi.fn().mockResolvedValue(null),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@abc123def',
        ref: 'actions/checkout@abc123def',
        name: 'actions/checkout',
        version: 'abc123def',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(result[0]!).toEqual({
      currentVersion: 'abc123def',
      latestVersion: 'v4.2.0',
      action: actions[0],
      isBreaking: false,
      latestSha: null,
      hasUpdate: true,
    })
  })

  it('falls back to tags when no releases are found', async () => {
    let mockClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'non-semver', sha: 'aaa111', message: null, date: null },
        { tag: 'v4.1.0', sha: 'bbb222', message: null, date: null },
      ]),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'pnpm/action-setup@v4.0.0',
        ref: 'pnpm/action-setup@v4.0.0',
        name: 'pnpm/action-setup',
        version: 'v4.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getLatestRelease).toHaveBeenCalledWith(
      'pnpm',
      'action-setup',
    )
    expect(mockClient.getAllReleases).toHaveBeenCalledWith(
      'pnpm',
      'action-setup',
      10,
    )
    expect(mockClient.getAllTags).toHaveBeenCalledWith(
      'pnpm',
      'action-setup',
      30,
    )
    expect(result[0]).toMatchObject({
      latestVersion: 'v4.1.0',
      latestSha: 'bbb222',
      hasUpdate: true,
    })
  })

  it('falls back to first tag when no semver-like tag exists', async () => {
    let mockClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'nightly', sha: 'ccc333', message: null, date: null },
        { tag: 'build-123', sha: 'ddd444', message: null, date: null },
      ]),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1',
        ref: 'owner/repo@v1',
        name: 'owner/repo',
        type: 'external',
        version: 'v1',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'nightly',
      latestSha: 'ccc333',
    })
  })

  it('skips update check for branch references', async () => {
    let mockClient = {
      getRefType: vi.fn().mockResolvedValue('branch'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getLatestRelease: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
    }

    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@main',
        ref: 'actions/checkout@main',
        name: 'actions/checkout',
        type: 'external',
        version: 'main',
      },
    ]

    let result = await checkUpdates(actions)

    expect(mockClient.getLatestRelease).not.toHaveBeenCalled()
    expect(mockClient.getAllReleases).not.toHaveBeenCalled()
    expect(mockClient.getAllTags).not.toHaveBeenCalled()
    expect(result[0]).toMatchObject({ latestVersion: null, hasUpdate: false })
  })
  it('uses "unknown" when action version is missing', async () => {
    let mockClient = {
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(Client).mockImplementation(() => mockClient as unknown as Client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/setup-node',
        name: 'actions/setup-node',
        ref: 'actions/setup-node',
        version: undefined,
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result).toHaveLength(1)
    expect(result[0]!.currentVersion).toBe('unknown')
    expect(result[0]!.latestVersion).toBeNull()
    expect(result[0]!.hasUpdate).toBeFalsy()
  })
})
