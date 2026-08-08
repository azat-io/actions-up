import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

import { selectExistingTagReference } from '../../core/updates/select-existing-tag-reference'

let latestSha = '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'
let staleSha = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12'

class GitHubRateLimitError extends Error {
  public constructor() {
    super('API rate limit exceeded')
    this.name = 'GitHubRateLimitError'
  }
}

function createClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getTagSha: vi.fn().mockResolvedValue(null),
    getAllTags: vi.fn().mockResolvedValue([]),
    shouldWaitForRateLimit: vi.fn(),
    getRateLimitStatus: vi.fn(),
    getLatestRelease: vi.fn(),
    getAllReleases: vi.fn(),
    getRefType: vi.fn(),
    getTagInfo: vi.fn(),
    ...overrides,
  }
}
describe('selectExistingTagReference', () => {
  it('returns floating tag when it exists and points at the latest release', async () => {
    let client = createClient({
      getTagSha: vi.fn().mockResolvedValue(latestSha),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      latestSha,
    })

    expect(result).toEqual({ rateLimited: false, reference: 'v8' })
    expect(client.getTagSha).toHaveBeenCalledWith('owner', 'repo', 'v8')
  })

  it('falls back to the exact latest version when no floating tag exists', async () => {
    let client = createClient()

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: false })
  })

  it('prefers a broader floating tag when the specific one is missing', async () => {
    let client = createClient({
      getTagSha: vi
        .fn()
        .mockImplementation((_owner: string, _repo: string, tag: string) =>
          Promise.resolve(tag === 'v6' ? latestSha : null),
        ),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      currentVersion: 'v6.1',
      latestSha,
    })

    expect(result).toEqual({ rateLimited: false, reference: 'v6' })
    expect(client.getTagSha).toHaveBeenCalledWith('owner', 'repo', 'v6.2')
    expect(client.getTagSha).toHaveBeenCalledWith('owner', 'repo', 'v6')
  })

  it('prefers a broader floating tag when the specific one is stale', async () => {
    let client = createClient({
      getTagSha: vi
        .fn()
        .mockImplementation((_owner: string, _repo: string, tag: string) =>
          Promise.resolve(tag === 'v6' ? latestSha : staleSha),
        ),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      currentVersion: 'v6.1',
      latestSha,
    })

    expect(result).toEqual({ rateLimited: false, reference: 'v6' })
  })

  it('skips a floating tag that does not point at the latest release', async () => {
    let client = createClient({
      getTagSha: vi.fn().mockResolvedValue(staleSha),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: false })
  })

  it('accepts an existing floating tag when latest SHA is unknown', async () => {
    let client = createClient({
      getTagSha: vi.fn().mockResolvedValue(staleSha),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      latestSha: null,
    })

    expect(result).toEqual({ rateLimited: false, reference: 'v8' })
  })

  it('reports rate limiting when tag validation hits the API limit', async () => {
    let rateLimitError = new GitHubRateLimitError()
    let client = createClient({
      getTagSha: vi.fn().mockRejectedValue(rateLimitError),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: true })
  })

  it('falls back without rate limit flag when tag lookup fails otherwise', async () => {
    let client = createClient({
      getTagSha: vi.fn().mockRejectedValue(new Error('network error')),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: false })
  })

  it('does not report rate limiting when a candidate still matches', async () => {
    let rateLimitError = new GitHubRateLimitError()
    let client = createClient({
      getTagSha: vi
        .fn()
        .mockImplementation((_owner: string, _repo: string, tag: string) =>
          tag === 'v6' ?
            Promise.resolve(latestSha)
          : Promise.reject(rateLimitError),
        ),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      currentVersion: 'v6.1',
      latestSha,
    })

    expect(result).toEqual({ rateLimited: false, reference: 'v6' })
  })

  it('returns the latest version for action name without owner', async () => {
    let client = createClient()

    let result = await selectExistingTagReference(client, {
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      actionName: '/repo',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: false })
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('returns the latest version for action name without repo', async () => {
    let client = createClient()

    let result = await selectExistingTagReference(client, {
      latestVersion: 'v8.3.2',
      currentVersion: 'v7',
      actionName: 'owner',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: false })
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('returns the latest version when no candidates can be built', async () => {
    let client = createClient()

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      currentVersion: 'v8.3.1',
      latestVersion: 'v8.3.2',
      latestSha,
    })

    expect(result).toEqual({ reference: 'v8.3.2', rateLimited: false })
    expect(client.getTagSha).not.toHaveBeenCalled()
  })
})
