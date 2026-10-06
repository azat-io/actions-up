import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { resolveGitHubTokenSync } from '../../../core/api/resolve-github-token-sync'

vi.mock(import('node:child_process'), () => ({ execFileSync: vi.fn() }))
vi.mock(import('node:fs'), () => ({ readFileSync: vi.fn() }))

const WORKING_DIRECTORY = '/home/runner/work/web-app'

const GIT_CONFIG_PATH = '/home/runner/work/web-app/.git/config'

const CONFIG_TOKEN = 'config-token'

const GITHUB_SECTION_CONFIG = `[github]\n\ttoken = ${CONFIG_TOKEN}\n`

const REPOSITORY_CONFIG = [
  '[core]',
  '\tbare = false',
  '[remote "origin"]',
  '\turl = https://github.com/acme/web-app.git',
  '\tfetch = +refs/heads/*:refs/remotes/origin/*',
  '[branch "main"]',
  '\tremote = origin',
  '\tmerge = refs/heads/main',
  '',
].join('\n')

/**
 * Token sources outside the process that the resolver consults after the
 * environment.
 */
interface TokenSources {
  /**
   * Text of the repository's `.git/config`, or undefined when there is none.
   */
  gitConfig?: string

  /**
   * Output of `gh auth token`, or undefined when `gh` is not available.
   */
  cli?: string
}

/**
 * Stub the `gh` CLI and the repository's git config.
 *
 * An unavailable `gh` fails to start, and a missing git config fails to open,
 * the way the real child process and file system report it. The CLI answers
 * only `gh auth token`; any other command fails like a command that exits with
 * an error. Both answer with a buffer unless asked for text, like their real
 * counterparts.
 *
 * @param sources - Sources that hold something.
 */
function mockTokenSources({ gitConfig, cli }: TokenSources = {}): void {
  vi.mocked(execFileSync).mockImplementation(
    (file, commandArguments, options) => {
      if (cli === undefined) {
        throw Object.assign(new Error('spawnSync gh ENOENT'), {
          code: 'ENOENT',
        })
      }
      if (!isAuthTokenCommand(file, commandArguments)) {
        throw Object.assign(new Error(`Command failed: ${file}`), { status: 1 })
      }
      return options?.encoding === 'utf8' ? cli : Buffer.from(cli)
    },
  )

  vi.mocked(readFileSync).mockImplementation((path, options: unknown) => {
    if (gitConfig === undefined || path !== GIT_CONFIG_PATH) {
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, open '${String(path)}'`),
        { code: 'ENOENT' },
      )
    }
    return readsText(options) ? gitConfig : Buffer.from(gitConfig)
  })
}

/**
 * Whether `readFileSync` options ask for the file as UTF-8 text, given either
 * as an encoding name or as an options object.
 *
 * @param options - Options passed to `readFileSync`.
 * @returns True when the content is to be decoded as UTF-8.
 */
function readsText(options: unknown): boolean {
  let encoding =
    typeof options === 'object' && options !== null && 'encoding' in options ?
      options.encoding
    : options
  return encoding === 'utf8'
}

/**
 * Whether a command is `gh auth token`.
 *
 * @param file - Executable the command runs.
 * @param commandArguments - Arguments passed to the executable.
 * @returns True for the command that prints the stored token.
 */
function isAuthTokenCommand(
  file: string,
  commandArguments: readonly string[] | undefined,
): boolean {
  return file === 'gh' && commandArguments?.join(' ') === 'auth token'
}

describe('resolveGitHubTokenSync', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(process, 'cwd').mockReturnValue(WORKING_DIRECTORY)
    vi.stubEnv('GITHUB_TOKEN', undefined)
    vi.stubEnv('GH_TOKEN', undefined)
    mockTokenSources()
  })

  afterEach(() => {
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns GITHUB_TOKEN from the environment', () => {
    vi.stubEnv('GITHUB_TOKEN', 'env-github-token')

    let token = resolveGitHubTokenSync()

    expect(token).toBe('env-github-token')
  })

  it('returns GH_TOKEN from the environment when GITHUB_TOKEN is not set', () => {
    vi.stubEnv('GH_TOKEN', 'env-gh-token')

    let token = resolveGitHubTokenSync()

    expect(token).toBe('env-gh-token')
  })

  it('reads the token printed by gh auth token when the environment has none', () => {
    mockTokenSources({ cli: 'gh-cli-token\n' })

    let token = resolveGitHubTokenSync()

    expect(token).toBe('gh-cli-token')
  })

  it.each([
    {
      sources: { gitConfig: GITHUB_SECTION_CONFIG, cli: 'gh-cli-token' },
      description: 'GITHUB_TOKEN over every other source',
      githubToken: 'env-github-token',
      expected: 'env-github-token',
      ghToken: 'env-gh-token',
    },
    {
      sources: { gitConfig: GITHUB_SECTION_CONFIG, cli: 'gh-cli-token' },
      description: 'GH_TOKEN over the gh CLI and the git config',
      expected: 'env-gh-token',
      ghToken: 'env-gh-token',
      githubToken: undefined,
    },
    {
      sources: { gitConfig: GITHUB_SECTION_CONFIG, cli: 'gh-cli-token' },
      description: 'the gh CLI over the git config',
      expected: 'gh-cli-token',
      githubToken: undefined,
      ghToken: undefined,
    },
  ])('prefers $description', ({ githubToken, expected, ghToken, sources }) => {
    vi.stubEnv('GITHUB_TOKEN', githubToken)
    vi.stubEnv('GH_TOKEN', ghToken)
    mockTokenSources(sources)

    let token = resolveGitHubTokenSync()

    expect(token).toBe(expected)
  })

  it.each([
    {
      sources: { gitConfig: undefined, cli: undefined },
      description: 'GITHUB_TOKEN',
      expected: 'env-gh-token',
      ghToken: 'env-gh-token',
      githubToken: ' \t ',
    },
    {
      sources: { gitConfig: undefined, cli: 'gh-cli-token' },
      expected: 'gh-cli-token',
      description: 'GH_TOKEN',
      githubToken: undefined,
      ghToken: ' \t ',
    },
    {
      sources: { gitConfig: GITHUB_SECTION_CONFIG, cli: '\n' },
      description: 'the gh CLI',
      expected: CONFIG_TOKEN,
      githubToken: undefined,
      ghToken: undefined,
    },
  ])(
    'skips a blank token from $description and uses the next source',
    ({ githubToken, expected, ghToken, sources }) => {
      vi.stubEnv('GITHUB_TOKEN', githubToken)
      vi.stubEnv('GH_TOKEN', ghToken)
      mockTokenSources(sources)

      let token = resolveGitHubTokenSync()

      expect(token).toBe(expected)
    },
  )

  it.each([
    { expected: 'env-github-token', variable: 'GITHUB_TOKEN' },
    { expected: 'env-gh-token', variable: 'GH_TOKEN' },
  ])('trims the whitespace around $variable', ({ variable, expected }) => {
    vi.stubEnv(variable, `  ${expected}\n`)

    let token = resolveGitHubTokenSync()

    expect(token).toBe(expected)
  })

  it.each([
    {
      gitConfig: `${REPOSITORY_CONFIG}[github]\n\tuser = octocat\n\ttoken = ${CONFIG_TOKEN}\n`,
      description: 'the token key of the github section',
    },
    {
      gitConfig: `[github]\n\toauth-token = ${CONFIG_TOKEN}\n`,
      description: 'the oauth-token key of the github section',
    },
    {
      gitConfig: `${REPOSITORY_CONFIG}[hub]\n\tprotocol = https\n\toauthtoken = ${CONFIG_TOKEN}\n`,
      description: 'the oauthtoken key of the hub section',
    },
    {
      description: 'a github section key written without spaces',
      gitConfig: `[github]\n\ttoken=${CONFIG_TOKEN}\n`,
    },
    {
      description: 'a hub section key written without spaces',
      gitConfig: `[hub]\n\toauthtoken=${CONFIG_TOKEN}\n`,
    },
    {
      gitConfig: `${REPOSITORY_CONFIG}github.token = ${CONFIG_TOKEN}\n`,
      description: 'a dotted github.token key',
    },
    {
      description: 'an indented dotted github.oauth-token key without spaces',
      gitConfig: `\tgithub.oauth-token=${CONFIG_TOKEN}\n`,
    },
    {
      description: 'a dotted hub.oauthtoken key with trailing spaces',
      gitConfig: `hub.oauthtoken = ${CONFIG_TOKEN}   \n`,
    },
  ])('reads the token from $description of .git/config', ({ gitConfig }) => {
    mockTokenSources({ gitConfig })

    let token = resolveGitHubTokenSync()

    expect(token).toBe(CONFIG_TOKEN)
  })

  it.each([
    {
      description: 'a git config without GitHub sections',
      gitConfig: REPOSITORY_CONFIG,
    },
    {
      gitConfig:
        '[github]\n\ttoken = \n\toauth-token =\n[hub]\n\toauthtoken =\n',
      description: 'GitHub keys with empty values',
    },
    {
      gitConfig: '[gitea]\n\ttoken = gitea-token\n\toauthtoken = gitea-token\n',
      description: 'token keys of another section',
    },
    { description: 'no git config', gitConfig: undefined },
  ])(
    'returns undefined for $description when no other source has a token',
    ({ gitConfig }) => {
      mockTokenSources({ gitConfig })

      let token = resolveGitHubTokenSync()

      expect(token).toBeUndefined()
    },
  )
})
