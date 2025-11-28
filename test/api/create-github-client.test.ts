import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

describe('createGitHubClient', () => {
  let originalEnvironment: NodeJS.ProcessEnv
  beforeEach(() => {
    originalEnvironment = { ...process.env }
  })
  afterEach(() => {
    process.env = originalEnvironment
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('exposes rate limit helpers', async () => {
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('token')
    let status = client.getRateLimitStatus()
    expect(status.remaining).toBe(5000)
    expect(client.shouldWaitForRateLimit(status.remaining + 1)).toBeTruthy()
    expect(client.shouldWaitForRateLimit(status.remaining)).toBeFalsy()
  })

  it('uses GITHUB_TOKEN from env when no token passed', async () => {
    process.env['GITHUB_TOKEN'] = 'env-token'
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient()
    expect(client.getRateLimitStatus().remaining).toBe(5000)
  })

  it('falls back to no token when nothing resolved', async () => {
    delete process.env['GITHUB_TOKEN']
    delete process.env['GH_TOKEN']
    vi.doMock('../../core/api/resolve-github-token-sync', () => ({
      resolveGitHubTokenSync: () => {},
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient()
    expect(client.getRateLimitStatus().remaining).toBe(60)
  })

  it('delegates getLatestRelease to implementation with proper args', async () => {
    let getLatestReleaseMock = vi.fn().mockResolvedValue(null)
    vi.doMock('../../core/api/get-latest-release', () => ({
      getLatestRelease: getLatestReleaseMock,
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('t')
    await client.getLatestRelease('owner', 'repo')
    expect(getLatestReleaseMock).toHaveBeenCalledOnce()
    let call = getLatestReleaseMock.mock.calls[0]!
    expect(call[1]).toBe('owner')
    expect(call[2]).toBe('repo')
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
  })

  it('delegates getRefType with proper args', async () => {
    let getReferenceTypeMock = vi.fn().mockResolvedValue('tag')
    vi.doMock('../../core/api/get-reference-type', () => ({
      getReferenceType: getReferenceTypeMock,
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('t')
    let result = await client.getRefType('owner', 'repo', 'ref')
    expect(result).toBe('tag')
    expect(getReferenceTypeMock).toHaveBeenCalledOnce()
    let call = getReferenceTypeMock.mock.calls[0]!
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
    expect(call[1]).toEqual({ reference: 'ref', owner: 'owner', repo: 'repo' })
  })

  it('delegates getAllReleases with proper args', async () => {
    let getAllReleasesMock = vi.fn().mockResolvedValue([])
    vi.doMock('../../core/api/get-all-releases', () => ({
      getAllReleases: getAllReleasesMock,
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('t')
    await client.getAllReleases('owner', 'repo', 42)
    expect(getAllReleasesMock).toHaveBeenCalledOnce()
    let call = getAllReleasesMock.mock.calls[0]!
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
    expect(call[1]).toEqual({ owner: 'owner', repo: 'repo', limit: 42 })
  })

  it('delegates getAllTags with proper args', async () => {
    let getAllTagsMock = vi.fn().mockResolvedValue([])
    vi.doMock('../../core/api/get-all-tags', () => ({
      getAllTags: getAllTagsMock,
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('t')
    await client.getAllTags('owner', 'repo', 7)
    expect(getAllTagsMock).toHaveBeenCalledOnce()
    let call = getAllTagsMock.mock.calls[0]!
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
    expect(call[1]).toEqual({ owner: 'owner', repo: 'repo', limit: 7 })
  })

  it('delegates getTagInfo with proper args', async () => {
    let getTagInfoMock = vi.fn().mockResolvedValue(null)
    vi.doMock('../../core/api/get-tag-info', () => ({
      getTagInfo: getTagInfoMock,
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('t')
    await client.getTagInfo('owner', 'repo', 'v1.2.3')
    expect(getTagInfoMock).toHaveBeenCalledOnce()
    let call = getTagInfoMock.mock.calls[0]!
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
    expect(call[1]).toEqual({ owner: 'owner', tag: 'v1.2.3', repo: 'repo' })
  })

  it('delegates getTagSha with proper args', async () => {
    let getTagShaMock = vi.fn().mockResolvedValue('sha')
    vi.doMock('../../core/api/get-tag-sha', () => ({
      getTagSha: getTagShaMock,
    }))
    let { createGitHubClient } =
      await import('../../core/api/create-github-client')
    let client = createGitHubClient('t')
    let result = await client.getTagSha('owner', 'repo', 'v1.2.3')
    expect(result).toBe('sha')
    expect(getTagShaMock).toHaveBeenCalledOnce()
    let call = getTagShaMock.mock.calls[0]!
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
    expect(call[1]).toEqual({ owner: 'owner', tag: 'v1.2.3', repo: 'repo' })
  })
})
