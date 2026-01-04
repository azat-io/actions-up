import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitHubAction } from '../../types/github-action'
import type { GitHubClient } from '../../types/github-client'

import { createGitHubClient } from '../../core/api/create-github-client'
import { checkUpdates } from '../../core/api/check-updates'

vi.mock(import('../../core/api/create-github-client'))

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

  it('returns empty array when no external actions provided', async () => {
    let client: GitHubClient = {
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getLatestRelease: vi.fn(),
      getAllReleases: vi.fn(),
      getRefType: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: './.github/actions/build',
        name: './.github/actions/build',
        ref: './.github/actions/build',
        version: 'main',
        type: 'local',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result).toEqual([])
    expect(client.getLatestRelease).not.toHaveBeenCalled()
  })

  it('logs warning when request fails with non rate-limit error', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockRejectedValue(new Error('boom')),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllReleases: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

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
    expect(result[0]).toMatchObject({ latestVersion: null, hasUpdate: false })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to check owner/repo:'),
      expect.any(Error),
    )
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
    expect(result[0]).toMatchObject({
      skipReason: 'branch',
      latestVersion: null,
      status: 'skipped',
      hasUpdate: false,
    })
    expect(client.getLatestRelease).not.toHaveBeenCalled()
  })

  it('includes branch references when explicitly enabled', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1.2.3',
        /* Cspell:disable-next-line */
        sha: 'branchsha',
        name: 'v1.2.3',
        url: 'u',
      }),
      getRefType: vi.fn().mockResolvedValue('branch'),
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
        uses: 'owner/repo@release/v1',
        ref: 'owner/repo@release/v1',
        version: 'release/v1',
        name: 'owner/repo',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions, undefined, {
      includeBranches: true,
    })
    expect(client.getLatestRelease).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.2.3',
      hasUpdate: true,
      status: 'ok',
    })
  })

  it('handles action name without owner/repo gracefully', async () => {
    let client: GitHubClient = {
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getLatestRelease: vi.fn(),
      getAllReleases: vi.fn(),
      getRefType: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        type: 'external',
        uses: 'invalid',
        name: 'invalid',
        ref: 'invalid',
        version: 'v1',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({ latestVersion: null, hasUpdate: false })
    expect(client.getLatestRelease).not.toHaveBeenCalled()
  })

  it('handles action name with missing repository segment', async () => {
    let client: GitHubClient = {
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getLatestRelease: vi.fn(),
      getAllReleases: vi.fn(),
      getRefType: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/@v1',
        ref: 'owner/@v1',
        type: 'external',
        name: 'owner/',
        version: 'v1',
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

  it('treats mismatched short SHA as needing update', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1.2.3',
        name: 'v1.2.3',
        sha: 'abcd',
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
        uses: 'owner/repo@abcdef0',
        ref: 'owner/repo@abcdef0',
        name: 'owner/repo',
        version: 'abcdef0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({ hasUpdate: true })
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

  it('prefers a more specific semver tag over moving major release v1', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1',
        /* Cspell:disable-next-line */
        sha: 'relsha',
        name: 'v1',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'abc1234', tag: 'v1.2.3', message: null, date: null },
        { sha: 'def5678', message: null, date: null, tag: 'v1' },
      ]),
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
    expect(client.getAllTags).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.2.3',
      latestSha: 'abc1234',
    })
  })

  it('throws friendly error when rate limit is hit and skips remaining actions', async () => {
    let rateLimitError = new Error('GitHub API rate limit exceeded.')
    rateLimitError.name = 'GitHubRateLimitError'

    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockRejectedValue(rateLimitError),
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
      {
        uses: 'owner/repo2@v1.0.0',
        ref: 'owner/repo2@v1.0.0',
        name: 'owner/repo2',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    await expect(checkUpdates(actions)).rejects.toMatchObject({
      name: 'GitHubRateLimitError',
    })

    expect(client.getLatestRelease).toHaveBeenCalledOnce()
  })

  it('release v1 tie-breaker also works with reversed tag order', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1',
        /* Cspell:disable-next-line */
        sha: 'relsha',
        name: 'v1',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'def5678', message: null, date: null, tag: 'v1' },
        { sha: 'abc1234', tag: 'v1.0.0', message: null, date: null },
      ]),
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
      latestVersion: 'v1.0.0',
      latestSha: 'abc1234',
    })
  })

  it('in release v1 flow resolves missing tag SHA via getTagSha', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1',
        /* Cspell:disable-next-line */
        sha: 'relsha',
        name: 'v1',
        url: 'u',
      }),
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { tag: 'v1.2.3', message: null, date: null, sha: '' },
        ]),
      getTagSha: vi.fn().mockResolvedValue('resolved-v123'),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
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
    expect(client.getAllTags).toHaveBeenCalledOnce()
    expect(client.getTagSha).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestSha: 'resolved-v123',
      latestVersion: 'v1.2.3',
    })
  })

  it('release with empty tag_name falls back to tags and uses best semver (covers undefined in valid())', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: '',
        sha: null,
        name: '',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'v0.9.0', message: null, date: null, sha: 'old' },
        { tag: 'v1.0.0', message: null, date: null, sha: 'new' },
      ]),
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
        uses: 'owner/repo@v0.1.0',
        ref: 'owner/repo@v0.1.0',
        name: 'owner/repo',
        version: 'v0.1.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(client.getAllTags).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.0.0',
      latestSha: 'new',
    })
  })

  it('release v1 flow: getTagSha error when best tag has no sha results in null (covers catch {})', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1',
        name: 'v1',
        sha: null,
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'v2.0.0', message: null, date: null, sha: '' },
        { tag: 'v1.5.0', message: null, date: null, sha: 'old' },
      ]),
      getTagSha: vi.fn().mockRejectedValue(new Error('fail sha')),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
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
    expect(client.getAllTags).toHaveBeenCalledOnce()
    expect(client.getTagSha).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v2.0.0',
      latestSha: null,
    })
  })

  it('prefers equally-versioned specific tag (v1.0.0) over release v1', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1',
        /* Cspell:disable-next-line */
        sha: 'relsha',
        name: 'v1',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        /* Cspell:disable-next-line */
        { tag: 'v1.0.0', message: null, sha: 'tagsha', date: null },
        /* Cspell:disable-next-line */
        { sha: 'othersha', message: null, date: null, tag: 'v1' },
      ]),
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
    expect(client.getAllTags).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.0.0',
      /* Cspell:disable-next-line */
      latestSha: 'tagsha',
    })
  })

  it('covers tie-breaker path when semver versions equal (release v1 -> tags v1.0.0 and 1.0.0)', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1',
        /* Cspell:disable-next-line */
        sha: 'relsha',
        name: 'v1',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'v1.0.0', message: null, sha: 'sha1', date: null },
        { message: null, tag: '1.0.0', sha: 'sha2', date: null },
      ]),
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
    expect(client.getAllTags).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.0.0',
      latestSha: 'sha1',
    })
  })

  it('covers tie-breaker path in tags-only flow with equal versions', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'sha-plain', message: null, tag: '1.0.0', date: null },
        { tag: 'v1.0.0', message: null, sha: 'sha-v', date: null },
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
        uses: 'owner/repo@v0.9.0',
        ref: 'owner/repo@v0.9.0',
        name: 'owner/repo',
        version: 'v0.9.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: '1.0.0',
      latestSha: 'sha-plain',
    })
  })

  it('tags-only tie-breaker also works with reversed order', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'v1.0.0', message: null, sha: 'sha-v', date: null },
        { sha: 'sha-plain', message: null, tag: '1.0.0', date: null },
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
        uses: 'owner/repo@v0.9.0',
        ref: 'owner/repo@v0.9.0',
        name: 'owner/repo',
        version: 'v0.9.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'v1.0.0',
      latestSha: 'sha-v',
    })
  })

  it('prefers specific tag over major-only in tags-only flow when versions equal', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'sha-major', message: null, date: null, tag: 'v1' },
        { sha: 'sha-specific', tag: 'v1.0.0', message: null, date: null },
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
        uses: 'owner/repo@v0.5.0',
        ref: 'owner/repo@v0.5.0',
        name: 'owner/repo',
        version: 'v0.5.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestSha: 'sha-specific',
      latestVersion: 'v1.0.0',
    })
  })

  it('tags-only tie-breaker: aSpecific=1 (v1.0.0 vs v1) prefers specific', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'sha-specific', tag: 'v1.0.0', message: null, date: null },
        { sha: 'sha-major', message: null, date: null, tag: 'v1' },
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
        uses: 'owner/repo@v0.8.0',
        ref: 'owner/repo@v0.8.0',
        name: 'owner/repo',
        version: 'v0.8.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestSha: 'sha-specific',
      latestVersion: 'v1.0.0',
    })
  })

  it('handles getTagSha error in tags-only flow (best tag without sha)', async () => {
    let client: GitHubClient = {
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { tag: 'v3.0.0', message: null, date: null, sha: '' },
        ]),
      getTagSha: vi.fn().mockRejectedValue(new Error('fail sha')),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v2.0.0',
        ref: 'owner/repo@v2.0.0',
        name: 'owner/repo',
        version: 'v2.0.0',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(client.getTagSha).toHaveBeenCalledOnce()
    expect(result[0]).toMatchObject({
      latestVersion: 'v3.0.0',
      latestSha: null,
    })
  })

  it('fetches SHA for best tag when tag SHA is missing in tags list (no releases)', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'v2.1.0', message: null, date: null, sha: '' },
        /* Cspell:disable-next-line */
        { tag: 'v2.0.0', message: null, sha: 'oldsha', date: null },
      ]),
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getTagSha: vi.fn().mockResolvedValue('resolved'),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
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
    expect(result[0]).toMatchObject({
      latestVersion: 'v2.1.0',
      latestSha: 'resolved',
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

  it('propagates rate-limit error with authenticated hint when token is used', async () => {
    let errorObject: { name: string } & Error = Object.assign(
      new Error('API rate limit exceeded. Resets at 00:00:00'),
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

    await expect(checkUpdates(actions, 'token')).rejects.toMatchObject({
      message: expect.stringContaining(
        'Wait for reset or reduce request rate.',
      ) as string,
      name: 'GitHubRateLimitError',
    })
  })

  it('uses default base message when rate-limit error has empty message', async () => {
    // eslint-disable-next-line unicorn/error-message
    let errorObject: { name: string } & Error = Object.assign(new Error(''), {
      name: 'GitHubRateLimitError',
    })

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

    await expect(checkUpdates(actions)).rejects.toMatchObject({
      message: expect.stringContaining(
        'GitHub API rate limit exceeded.',
      ) as string,
      name: 'GitHubRateLimitError',
    })
  })

  it('treats missing current version as unknown', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1.0.0',
        sha: 'abc1234def',
        name: 'v1.0.0',
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
        uses: 'owner/repo@latest',
        ref: 'owner/repo@latest',
        name: 'owner/repo',
        version: undefined,
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      currentVersion: 'unknown',
      latestVersion: 'v1.0.0',
    })
  })

  it('falls back to empty cache entry when action name mutates mid-run', async () => {
    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@v1.0.0',
        ref: 'owner/repo@v1.0.0',
        name: 'owner/repo',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockImplementation(() => {
        actions[0]!.name = 'owner/repo-renamed'
        return Promise.resolve({
          publishedAt: new Date('2024-01-01'),
          isPrerelease: false,
          sha: 'release-sha',
          description: null,
          version: 'v2.0.0',
          name: 'v2.0.0',
          url: 'u',
        })
      }),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let result = await checkUpdates(actions)
    let [first] = result
    expect(first?.action.name).toBe('owner/repo-renamed')
    expect(first?.latestVersion).toBeNull()
    expect(first?.hasUpdate).toBeFalsy()
    expect(first?.latestSha).toBeNull()
  })

  it('treats identical commit SHAs as up to date', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01T00:00:00Z'),
        isPrerelease: false,
        description: null,
        version: 'v2.0.0',
        name: 'v2.0.0',
        sha: 'abcdef1',
        url: 'u',
      }),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
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
    expect(result[0]).toMatchObject({
      latestVersion: 'v2.0.0',
      latestSha: 'abcdef1',
      hasUpdate: false,
    })
  })

  it('suggests pinning to SHA when unpinned tag resolves to a known commit', async () => {
    let accessCount = 0
    let action = {
      uses: 'owner/repo@v1',
      ref: 'owner/repo@v1',
      name: 'owner/repo',
      type: 'external',
    } as GitHubAction

    Object.defineProperty(action, 'version', {
      get() {
        accessCount += 1
        return accessCount === 3 ? undefined : 'v1.0.0'
      },
      configurable: true,
      enumerable: true,
    })

    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        description: null,
        version: 'v1.0.0',
        name: 'v1.0.0',
        sha: 'tagSha',
        url: 'u',
      }),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let result = await checkUpdates([action])
    let [update] = result
    expect(update?.action.name).toBe('owner/repo')
    expect(update?.currentVersion).toBe('v1.0.0')
    expect(update?.latestVersion).toBe('v1.0.0')
    expect(update?.latestSha).toBe('tagSha')
    expect(update?.isBreaking).toBeFalsy()
    expect(update?.hasUpdate).toBeTruthy()
  })

  it('ignores tags without names when evaluating semver candidates', async () => {
    let client: GitHubClient = {
      getAllTags: vi.fn().mockResolvedValue([
        {
          get tag() {
            return ''
          },
          message: null,
          sha: 'zzz',
          date: null,
        } as unknown as { message: null; tag: string; sha: string; date: null },
        { sha: 'validSha', tag: 'v1.1.0', message: null, date: null },
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
      latestSha: 'validSha',
    })
  })

  it('returns null results for actions skipped due to rate limit', async () => {
    let callCount = 0
    let rateLimitError = new Error('GitHub API rate limit exceeded.')
    rateLimitError.name = 'GitHubRateLimitError'

    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockImplementation(() => {
        callCount += 1
        if (callCount === 1) {
          return Promise.resolve({
            publishedAt: new Date('2024-01-01'),
            isPrerelease: false,
            description: null,
            version: 'v1.0.0',
            name: 'v1.0.0',
            sha: 'abc',
            url: 'u',
          })
        }
        return Promise.reject(rateLimitError)
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
        uses: 'owner/first@v1.0.0',
        ref: 'owner/first@v1.0.0',
        name: 'owner/first',
        version: 'v1.0.0',
        type: 'external',
      },
      {
        uses: 'owner/second@v1.0.0',
        ref: 'owner/second@v1.0.0',
        name: 'owner/second',
        version: 'v1.0.0',
        type: 'external',
      },
      {
        uses: 'owner/third@v1.0.0',
        ref: 'owner/third@v1.0.0',
        name: 'owner/third',
        version: 'v1.0.0',
        type: 'external',
      },
    ]

    await expect(checkUpdates(actions)).rejects.toMatchObject({
      name: 'GitHubRateLimitError',
    })
  })

  it('prefers best tag when release version is invalid semver', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        version: 'invalid-version',
        name: 'invalid-version',
        isPrerelease: false,
        sha: 'release-sha',
        description: null,
        url: 'u',
      }),
      getAllTags: vi
        .fn()
        .mockResolvedValue([
          { sha: 'tag-sha', tag: 'v2.0.0', message: null, date: null },
        ]),
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
      latestVersion: 'v2.0.0',
      latestSha: 'tag-sha',
    })
  })

  it('keeps release when moving major tag is not more specific', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        sha: 'release-sha',
        description: null,
        version: 'v2',
        name: 'v2',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { sha: 'tag-sha', message: null, date: null, tag: 'v2' },
        { sha: 'tag-old', tag: 'v1.9.0', message: null, date: null },
      ]),
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
        uses: 'owner/repo@v2',
        ref: 'owner/repo@v2',
        name: 'owner/repo',
        type: 'external',
        version: 'v2',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestSha: 'release-sha',
      latestVersion: 'v2',
    })
  })

  it('falls back to release when tags are not semver-like', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        sha: 'release-sha',
        description: null,
        version: 'v1',
        name: 'v1',
        url: 'u',
      }),
      getAllTags: vi.fn().mockResolvedValue([
        { tag: 'latest', message: null, sha: 'tag-a', date: null },
        { tag: 'release', message: null, sha: 'tag-b', date: null },
      ]),
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
      latestSha: 'release-sha',
      latestVersion: 'v1',
    })
  })

  it('flags update when current version is a SHA and latest SHA is missing', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        version: 'v2.0.0',
        description: null,
        name: 'v2.0.0',
        sha: null,
        url: 'u',
      }),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getTagSha: vi.fn().mockResolvedValue(null),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getAllTags: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@abcdef1234567',
        ref: 'owner/repo@abcdef1234567',
        version: 'abcdef1234567',
        name: 'owner/repo',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'v2.0.0',
      hasUpdate: true,
      latestSha: null,
    })
  })

  it('does not flag update when SHA has no latest version', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue(null),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
      getTagSha: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@abcdef1234567',
        ref: 'owner/repo@abcdef1234567',
        version: 'abcdef1234567',
        name: 'owner/repo',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: null,
      hasUpdate: false,
      latestSha: null,
    })
  })

  it('flags update when non-semver versions differ', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        isPrerelease: false,
        version: 'latest',
        description: null,
        name: 'latest',
        sha: null,
        url: 'u',
      }),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getTagSha: vi.fn().mockResolvedValue(null),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@dev-build',
        ref: 'owner/repo@dev-build',
        version: 'dev-build',
        name: 'owner/repo',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'latest',
      hasUpdate: true,
    })
  })

  it('does not flag update when non-semver versions match', async () => {
    let client: GitHubClient = {
      getLatestRelease: vi.fn().mockResolvedValue({
        publishedAt: new Date('2024-01-01'),
        version: 'dev-build',
        isPrerelease: false,
        name: 'dev-build',
        description: null,
        sha: null,
        url: 'u',
      }),
      getAllReleases: vi.fn().mockResolvedValue([]),
      getRefType: vi.fn().mockResolvedValue('tag'),
      getTagSha: vi.fn().mockResolvedValue(null),
      getAllTags: vi.fn().mockResolvedValue([]),
      shouldWaitForRateLimit: vi.fn(),
      getRateLimitStatus: vi.fn(),
      getTagInfo: vi.fn(),
    }
    vi.mocked(createGitHubClient).mockReturnValue(client)

    let actions: GitHubAction[] = [
      {
        uses: 'owner/repo@dev-build',
        ref: 'owner/repo@dev-build',
        version: 'dev-build',
        name: 'owner/repo',
        type: 'external',
      },
    ]

    let result = await checkUpdates(actions)
    expect(result[0]).toMatchObject({
      latestVersion: 'dev-build',
      hasUpdate: false,
    })
  })
})
