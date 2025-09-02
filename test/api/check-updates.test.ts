import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubAction } from '../../types/github-action'
import type { GitHubClient } from '../../types/github-client'

import { createGitHubClient } from '../../core/api/create-github-client'
import { checkUpdates } from '../../core/api/check-updates'

vi.mock('../../core/api/create-github-client')

describe('checkUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dedupes actions by name and calls client once', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01T00:00:00Z'),
        isPrerelease: false,
        description: null,
        version: 'v1.0.0',
        name: 'v1.0.0',
        sha: 'abc',
        url: 'u',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'actions/checkout@v1',
        ref: 'actions/checkout@v1',
        name: 'actions/checkout',
        type: 'external',
        version: 'v1',
      },
      {
        uses: 'actions/checkout@v1',
        ref: 'actions/checkout@v1',
        name: 'actions/checkout',
        type: 'external',
        version: 'v1',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result).toHaveLength(2)
    expect(client.getLatestRelease).toHaveBeenCalledOnce()
  })

  it('skips branch references', async () => {
    let client: GitHubClient = {
      getRefType: vi.fn().mockResolvedValue('branch'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getLatestRelease: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@main',
        ref: 'owner/repo@main',
        name: 'owner/repo',
        type: 'external',
        version: 'main',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({ latestVersion: null, hasUpdate: false })
    expect(client.getLatestRelease).not.toHaveBeenCalled()
  })

  it('falls back to releases list when latest is null and uses stable', async () => {
    let client = {
      getAllReleases: vi.fn().mockResolvedValue([
        {
          publishedAt: new Date('2024-01-02'),
          version: 'v2.0.0-beta',
          description: 'beta',
          isPrerelease: true,
          name: 'beta',
          url: 'u1',
          sha: null,
        },
        {
          publishedAt: new Date('2024-01-01'),
          description: 'stable',
          isPrerelease: false,
          version: 'v1.5.0',
          name: 'stable',
          url: 'u2',
          sha: 's',
        },
      ]),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(
      await import('../../core/api/create-github-client'),
    ).createGitHubClient.mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1.0.0',
        ref: 'owner/repo@v1.0.0',
        name: 'owner/repo',
        version: 'v1.0.0',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.5.0',
      hasUpdate: true,
      latestSha: 's',
    })
  })

  it('marks update when current is SHA and latestSha missing but version present', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1.2.3',
        name: 'v1.2.3',
        sha: null,
        url: 'u',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getTagSha: vi.fn().mockResolvedValue(null),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@abcdef1',
        ref: 'owner/repo@abcdef1',
        name: 'owner/repo',
        version: 'abcdef1',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({ hasUpdate: true })
  })

  it('does not mark update when current SHA equals latestSha', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1.2.3',
        name: 'v1.2.3',
        sha: 'abcdef1',
        url: 'u',
      }),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@abcdef1',
        ref: 'owner/repo@abcdef1',
        name: 'owner/repo',
        version: 'abcdef1',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({ hasUpdate: false })
  })

  it('falls back to tags when no releases found', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'non-semver', message: null, date: null, sha: 'a' },
        { tag: 'v1.1.0', message: null, date: null, sha: 'b' },
      ]),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1.0.0',
        ref: 'owner/repo@v1.0.0',
        name: 'owner/repo',
        version: 'v1.0.0',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.1.0',
      hasUpdate: true,
      latestSha: 'b',
    })
  })

  it('falls back to first tag when no semver-like tag exists', async () => {
    let client: GitHubClient = {
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
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

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

  it('ignores getTagSha errors and continues', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v2.0.0',
        name: 'v2.0.0',
        sha: null,
        url: 'u',
      }),
      getTagSha: vi.fn().mockRejectedValue(new Error('temporary')),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1.0.0',
        ref: 'owner/repo@v1.0.0',
        name: 'owner/repo',
        version: 'v1.0.0',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'v2.0.0',
      latestSha: null,
      hasUpdate: true,
    })
  })

  it('uses "unknown" when action version is missing', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getRefType: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        version: undefined as unknown as string,
        uses: 'owner/repo',
        name: 'owner/repo',
        ref: 'owner/repo',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      currentVersion: 'unknown',
      latestVersion: null,
      hasUpdate: false,
    })
  })

  it('fetches SHA via getTagSha when latest has no SHA', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        version: 'v2.0.0',
        description: 'd',
        name: 'v2.0.0',
        sha: null,
        url: 'u',
      }),
      getTagSha: vi.fn().mockResolvedValue('sha-from-tag'),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)
    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1.0.0',
        ref: 'owner/repo@v1.0.0',
        name: 'owner/repo',
        version: 'v1.0.0',
        type: 'external',
      },
    ]
    let result = await checkUpdates(actions)
    expect(client.getTagSha).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({ latestSha: 'sha-from-tag' })
  })

  it('propagates rate-limit error', async () => {
    let errorObject: { name: string } & Error = Object.assign(
      new Error('rate'),
      { name: 'GitHubRateLimitError' },
    )
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockRejectedValue(errorObject),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1.0.0',
        ref: 'owner/repo@v1.0.0',
        name: 'owner/repo',
        version: 'v1.0.0',
        type: 'external',
      },
    ]
    await expect(checkUpdates(actions)).rejects.toHaveProperty(
      'name',
      'GitHubRateLimitError',
    )
  })
})
