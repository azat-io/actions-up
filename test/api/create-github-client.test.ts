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
    let { createGitHubClient } = await import(
      '../../core/api/create-github-client'
    )
    let client = createGitHubClient('token')
    let status = client.getRateLimitStatus()
    expect(status.remaining).toBe(5000)
    expect(client.shouldWaitForRateLimit(status.remaining + 1)).toBeTruthy()
    expect(client.shouldWaitForRateLimit(status.remaining)).toBeFalsy()
  })

  it('uses GITHUB_TOKEN from env when no token passed', async () => {
    process.env['GITHUB_TOKEN'] = 'env-token'
    let { createGitHubClient } = await import(
      '../../core/api/create-github-client'
    )
    let client = createGitHubClient()
    expect(client.getRateLimitStatus().remaining).toBe(5000)
  })

  it('falls back to no token when nothing resolved', async () => {
    delete process.env['GITHUB_TOKEN']
    delete process.env['GH_TOKEN']
    vi.doMock('../../core/api/resolve-github-token-sync', () => ({
      resolveGitHubTokenSync: () => {},
    }))
    let { createGitHubClient } = await import(
      '../../core/api/create-github-client'
    )
    let client = createGitHubClient()
    expect(client.getRateLimitStatus().remaining).toBe(60)
  })

  it('delegates getLatestRelease to implementation with proper args', async () => {
    let getLatestReleaseMock = vi.fn().mockResolvedValue(null)
    vi.doMock('../../core/api/get-latest-release', () => ({
      getLatestRelease: getLatestReleaseMock,
    }))
    let { createGitHubClient } = await import(
      '../../core/api/create-github-client'
    )
    let client = createGitHubClient('t')
    await client.getLatestRelease('owner', 'repo')
    expect(getLatestReleaseMock).toHaveBeenCalledOnce()
    let call = getLatestReleaseMock.mock.calls[0]!
    expect(call[1]).toBe('owner')
    expect(call[2]).toBe('repo')
    expect(call[0]).toMatchObject({ baseUrl: 'https://api.github.com' })
  })
})
