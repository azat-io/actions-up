import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('resolveGitHubTokenSync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unmock('node:child_process')
    vi.unmock('node:fs')
    delete process.env['GITHUB_TOKEN']
    delete process.env['GH_TOKEN']
  })

  it('returns GITHUB_TOKEN from env', async () => {
    process.env['GITHUB_TOKEN'] = 'env-token'
    let { resolveGitHubTokenSync } = await import(
      '../../core/api/resolve-github-token-sync'
    )
    expect(resolveGitHubTokenSync()).toBe('env-token')
  })

  it('falls back to GH_TOKEN from env', async () => {
    process.env['GH_TOKEN'] = 'gh-token'
    let { resolveGitHubTokenSync } = await import(
      '../../core/api/resolve-github-token-sync'
    )
    expect(resolveGitHubTokenSync()).toBe('gh-token')
  })

  it('reads token from gh CLI', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => 'cli-token\n'),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => {
        throw new Error('no git config')
      }),
    }))
    let { resolveGitHubTokenSync } = await import(
      '../../core/api/resolve-github-token-sync'
    )
    expect(resolveGitHubTokenSync()).toBe('cli-token')
  })

  it('parses token from .git/config (direct key)', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => 'github.token = direct\n'),
    }))
    let { resolveGitHubTokenSync } = await import(
      '../../core/api/resolve-github-token-sync'
    )
    expect(resolveGitHubTokenSync()).toBe('direct')
  })

  it('parses token from .git/config (section)', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => '[github]\n    token = section\n'),
    }))
    let { resolveGitHubTokenSync } = await import(
      '../../core/api/resolve-github-token-sync'
    )
    expect(resolveGitHubTokenSync()).toBe('section')
  })
})
