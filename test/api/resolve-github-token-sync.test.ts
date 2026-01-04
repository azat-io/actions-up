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
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBe('env-token')
  })

  it('falls back to GH_TOKEN from env', async () => {
    process.env['GH_TOKEN'] = 'gh-token'
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
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
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
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
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
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
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBe('section')
  })

  it('parses token from .git/config hub section', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => '[hub]\n    oauthtoken = hub-token\n'),
    }))
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBe('hub-token')
  })

  it('returns undefined when no token source succeeds', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => ''),
    }))
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBeUndefined()
  })

  it('parses oauth-token from github section', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => '[github]\n    oauth-token = oauth\n'),
    }))
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBe('oauth')
  })

  it('trims whitespace from token values', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(() => '[hub]\n    oauthtoken = trimmed-token   \n'),
    }))
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBe('trimmed-token')
  })

  it('ignores empty tokens in github and hub sections', async () => {
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(() => {
        throw new Error('no cli')
      }),
    }))
    vi.doMock('node:fs', () => ({
      readFileSync: vi.fn(
        () =>
          '[github]\n' +
          '    token = \n' +
          '    oauth-token =\n' +
          '[hub]\n' +
          '    oauthtoken =\n',
      ),
    }))
    let { resolveGitHubTokenSync } =
      await import('../../core/api/resolve-github-token-sync')
    expect(resolveGitHubTokenSync()).toBeUndefined()
  })
})
