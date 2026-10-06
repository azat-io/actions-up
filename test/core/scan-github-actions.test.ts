// CSpell:ignore unstub
import type { PathLike } from 'node:fs'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, lstat, stat } from 'node:fs/promises'

import type { FakeEntry } from '../helpers/create-fake-file-system'
import type { GitHubAction } from '../../types/github-action'

import {
  createFakeFileSystem,
  fakeUnreadableFile,
  fakeDirectory,
  fakeSymlink,
} from '../helpers/create-fake-file-system'
import { scanGitHubActions } from '../../core/scan-github-actions'
import { scanRecursive } from '../../core/scan-recursive'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
}))

/**
 * Absolute paths of a repository mapped to file text or special entries.
 */
type FakeTree = Record<string, FakeEntry | string>

/**
 * `GITHUB_REPOSITORY` as an empty value, which the scanner treats as unset. The
 * tests stub it rather than leave it alone, because CI always sets it.
 */
const UNSET_GITHUB_REPOSITORY = ''

/**
 * Serve `readFile`, `readdir`, `stat` and `lstat` from an in-memory tree for
 * the running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: FakeTree): void {
  let fileSystem = createFakeFileSystem(entries)
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
  vi.mocked<(path: PathLike) => Promise<string[]>>(readdir).mockImplementation(
    fileSystem.readdir,
  )
  vi.mocked(stat).mockImplementation(fileSystem.stat)
  vi.mocked(lstat).mockImplementation(fileSystem.lstat)
}

/**
 * Text of a `.git/config` that declares the given remotes in order.
 *
 * @param remotes - Remote names and URLs.
 * @returns Git config text.
 */
function makeGitConfig(...remotes: { name: string; url: string }[]): string {
  return [
    '[core]',
    '\tbare = false',
    ...remotes.flatMap(({ name, url }) => [
      `[remote "${name}"]`,
      `\turl = ${url}`,
      `\tfetch = +refs/heads/*:refs/remotes/${name}/*`,
    ]),
    '[branch "main"]',
    '\tremote = origin',
    '\tmerge = refs/heads/main',
    '',
  ].join('\n')
}

/**
 * Entry reported for the CI workflow step that uses `acme/demo/tools/setup`.
 *
 * @param overrides - Fields that differ, such as the reference of a repository
 *   with another name.
 * @returns Expected action.
 */
function makeSharedSetupReference(
  overrides: Partial<GitHubAction> = {},
): GitHubAction {
  return {
    file: '/repo/.github/workflows/ci.yml',
    uses: 'acme/demo/tools/setup@v1',
    name: 'acme/demo/tools/setup',
    ref: 'acme/demo@v1',
    type: 'external',
    version: 'v1',
    job: 'build',
    line: 7,
    ...overrides,
  }
}

/**
 * Serve a repository whose CI workflow uses `acme/demo/tools/setup`, a
 * composite action stored in the same repository at `tools/setup`.
 *
 * @param files - Further entries of the repository, such as `.git/config`.
 */
function arrangeRepoWithSharedSetup(files: FakeTree): void {
  installFileSystem({
    '/repo/tools/setup/action.yml': makeCompositeActionText(
      'actions/setup-node@v4',
    ),
    '/repo/.github/workflows/ci.yml': makeWorkflowText(
      'acme/demo/tools/setup@v1',
    ),
    ...files,
  })
}

/**
 * Text of a composite action with one step per action reference; the steps
 * start on line 6.
 *
 * @param references - Action references of the steps.
 * @returns Composite action YAML text.
 */
function makeCompositeActionText(...references: string[]): string {
  return [
    'name: Shared steps',
    'description: Steps shared by the workflows',
    'runs:',
    '  using: composite',
    '  steps:',
    ...references.map(reference => `    - uses: ${reference}`),
    '',
  ].join('\n')
}

/**
 * Text of a workflow whose `build` job has one step per action reference; the
 * steps start on line 7.
 *
 * @param references - Action references of the steps.
 * @returns Workflow YAML text.
 */
function makeWorkflowText(...references: string[]): string {
  return [
    'name: CI',
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...references.map(reference => `      - uses: ${reference}`),
    '',
  ].join('\n')
}

/**
 * Entry reported for the step inside the followed `tools/setup` action.
 *
 * @returns Expected action.
 */
function makeSharedSetupStep(): GitHubAction {
  return {
    file: '/repo/tools/setup/action.yml',
    uses: 'actions/setup-node@v4',
    ref: 'actions/setup-node@v4',
    name: 'actions/setup-node',
    type: 'external',
    version: 'v4',
    line: 6,
  }
}

describe('scanGitHubActions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('GITHUB_REPOSITORY', UNSET_GITHUB_REPOSITORY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reports the workflows and composite actions under .github with every action they use', async () => {
    installFileSystem({
      '/repo/.github/workflows/release.yml': [
        'name: Release',
        'on:',
        '  push:',
        "    tags: ['v*']",
        'jobs:',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/setup-node@v4',
        '',
      ].join('\n'),
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'actions/checkout@v4',
        './.github/actions/setup',
      ),
      '/repo/.github/actions/setup/action.yml': makeCompositeActionText(
        'pnpm/action-setup@v4',
      ),
    })
    let expectedCheckout = {
      file: '/repo/.github/workflows/ci.yml',
      uses: 'actions/checkout@v4',
      ref: 'actions/checkout@v4',
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
      job: 'build',
      line: 7,
    }
    let expectedLocalSetup = {
      file: '/repo/.github/workflows/ci.yml',
      uses: './.github/actions/setup',
      name: './.github/actions/setup',
      version: undefined,
      type: 'local',
      job: 'build',
      line: 8,
    }
    let expectedSetupNode = {
      file: '/repo/.github/workflows/release.yml',
      uses: 'actions/setup-node@v4',
      ref: 'actions/setup-node@v4',
      name: 'actions/setup-node',
      type: 'external',
      job: 'publish',
      version: 'v4',
      line: 9,
    }
    let expectedPnpmSetup = {
      file: '/repo/.github/actions/setup/action.yml',
      uses: 'pnpm/action-setup@v4',
      ref: 'pnpm/action-setup@v4',
      name: 'pnpm/action-setup',
      type: 'external',
      version: 'v4',
      line: 6,
    }

    let result = await scanGitHubActions('/repo')

    expect(result.workflows).toStrictEqual(
      new Map([
        ['.github/workflows/ci.yml', [expectedCheckout, expectedLocalSetup]],
        ['.github/workflows/release.yml', [expectedSetupNode]],
      ]),
    )
    expect(result.compositeActions.keys().toArray()).toStrictEqual(['setup'])
    expect(result.actions).toHaveLength(4)
    expect(result.actions).toStrictEqual(
      expect.arrayContaining([
        expectedCheckout,
        expectedLocalSetup,
        expectedSetupNode,
        expectedPnpmSetup,
      ]),
    )
  })

  it('keeps a workflow that uses no actions', async () => {
    installFileSystem({
      '/repo/.github/workflows/lint.yml': [
        'name: Lint',
        'on: push',
        'jobs:',
        '  lint:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: pnpm lint',
        '',
      ].join('\n'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result).toStrictEqual({
      workflows: new Map([['.github/workflows/lint.yml', []]]),
      compositeActions: new Map(),
      actions: [],
    })
  })

  it('ignores files in the workflows directory that are not YAML', async () => {
    installFileSystem({
      '/repo/.github/workflows/nightly.yml.disabled':
        makeWorkflowText('actions/cache@v4'),
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
      '/repo/.github/workflows/README.md': '# Workflows\n',
    })

    let result = await scanGitHubActions('/repo')

    expect(result.workflows.keys().toArray()).toStrictEqual([
      '.github/workflows/ci.yml',
    ])
  })

  it('skips a workflow whose file name contains a parent-directory sequence and warns about it', async () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFileSystem({
      '/repo/.github/workflows/..evil.yml': makeWorkflowText(
        'attacker/exfiltrate@v1',
      ),
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.workflows.keys().toArray()).toStrictEqual([
      '.github/workflows/ci.yml',
    ])
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Skipping invalid name: ..evil.yml',
    )
  })

  it('leaves out a workflow that cannot be read and keeps the others', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
      '/repo/.github/workflows/broken.yml': fakeUnreadableFile(),
    })
    let expectedCheckout = {
      file: '/repo/.github/workflows/ci.yml',
      uses: 'actions/checkout@v4',
      ref: 'actions/checkout@v4',
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
      job: 'build',
      line: 7,
    }

    let result = await scanGitHubActions('/repo')

    expect(result).toStrictEqual({
      workflows: new Map([['.github/workflows/ci.yml', [expectedCheckout]]]),
      compositeActions: new Map(),
      actions: [expectedCheckout],
    })
  })

  it.each<{ files: FakeTree; case: string }>([
    {
      files: {
        '/repo/src/index.ts': 'export {}\n',
        '/repo/README.md': '# Demo\n',
      },
      case: 'the repository has no .github directory',
    },
    {
      files: {
        '/repo/.github/workflows': fakeDirectory(),
        '/repo/.github/actions': fakeDirectory(),
      },
      case: 'the workflows and actions directories are empty',
    },
  ])('returns an empty result when $case', async ({ files }) => {
    installFileSystem(files)

    let result = await scanGitHubActions('/repo')

    expect(result).toStrictEqual({
      compositeActions: new Map(),
      workflows: new Map(),
      actions: [],
    })
  })

  it('reports nothing from the workflows path when it is a file and keeps scanning composite actions', async () => {
    installFileSystem({
      '/repo/.github/actions/setup/action.yml': makeCompositeActionText(
        'actions/setup-node@v4',
      ),
      '/repo/.github/workflows': makeWorkflowText('actions/checkout@v4'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.workflows).toStrictEqual(new Map())
    expect(result.compositeActions.keys().toArray()).toStrictEqual(['setup'])
    expect(result.actions).toStrictEqual([
      {
        file: '/repo/.github/actions/setup/action.yml',
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        type: 'external',
        version: 'v4',
        line: 6,
      },
    ])
  })

  it('reports nothing from the actions path when it is a file and keeps scanning workflows', async () => {
    installFileSystem({
      '/repo/.github/actions': makeCompositeActionText('actions/setup-node@v4'),
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
    })
    let expectedCheckout = {
      file: '/repo/.github/workflows/ci.yml',
      uses: 'actions/checkout@v4',
      ref: 'actions/checkout@v4',
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
      job: 'build',
      line: 7,
    }

    let result = await scanGitHubActions('/repo')

    expect(result).toStrictEqual({
      workflows: new Map([['.github/workflows/ci.yml', [expectedCheckout]]]),
      compositeActions: new Map(),
      actions: [expectedCheckout],
    })
  })

  it.each([
    ['action.yml', '/repo/action.yml'],
    ['action.yaml', '/repo/action.yaml'],
  ])(
    'registers a root %s as a composite action and reports its actions',
    async (fileName, filePath) => {
      installFileSystem({
        [filePath]: makeCompositeActionText('actions/setup-node@v4'),
      })

      let result = await scanGitHubActions('/repo')

      expect(result.compositeActions.keys().toArray()).toStrictEqual([fileName])
      expect(result.actions).toStrictEqual([
        {
          uses: 'actions/setup-node@v4',
          ref: 'actions/setup-node@v4',
          name: 'actions/setup-node',
          type: 'external',
          file: filePath,
          version: 'v4',
          line: 6,
        },
      ])
    },
  )

  it('prefers a root action.yml over an action.yaml next to it', async () => {
    installFileSystem({
      '/repo/action.yml': makeCompositeActionText('actions/setup-node@v4'),
      '/repo/action.yaml': makeCompositeActionText('actions/cache@v4'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.compositeActions.keys().toArray()).toStrictEqual([
      'action.yml',
    ])
    expect(result.actions).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        file: '/repo/action.yml',
        type: 'external',
        version: 'v4',
        line: 6,
      },
    ])
  })

  it('registers a root composite action that has no steps yet', async () => {
    installFileSystem({
      '/repo/action.yml': [
        'name: Release notes',
        'description: Drafts release notes',
        'runs:',
        '  using: composite',
        '  steps: []',
        '',
      ].join('\n'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.compositeActions.keys().toArray()).toStrictEqual([
      'action.yml',
    ])
    expect(result.actions).toStrictEqual([])
  })

  it.each([['/repo/action.yml'], ['/repo/action.yaml']])(
    'treats a root action file %s that cannot be read as absent',
    async filePath => {
      installFileSystem({
        '/repo/.github/workflows/ci.yml': makeWorkflowText(
          'actions/checkout@v4',
        ),
        [filePath]: fakeUnreadableFile(),
      })
      let expectedCheckout = {
        file: '/repo/.github/workflows/ci.yml',
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        version: 'v4',
        job: 'build',
        line: 7,
      }

      let result = await scanGitHubActions('/repo')

      expect(result).toStrictEqual({
        workflows: new Map([['.github/workflows/ci.yml', [expectedCheckout]]]),
        compositeActions: new Map(),
        actions: [expectedCheckout],
      })
    },
  )

  it('reads a composite action that is defined in action.yaml', async () => {
    installFileSystem({
      '/repo/.github/actions/cache/action.yaml':
        makeCompositeActionText('actions/cache@v4'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.compositeActions.keys().toArray()).toStrictEqual(['cache'])
    expect(result.actions).toStrictEqual([
      {
        file: '/repo/.github/actions/cache/action.yaml',
        uses: 'actions/cache@v4',
        ref: 'actions/cache@v4',
        name: 'actions/cache',
        type: 'external',
        version: 'v4',
        line: 6,
      },
    ])
  })

  it('skips an action directory whose name contains a parent-directory sequence and warns about it', async () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFileSystem({
      '/repo/.github/actions/..bad/action.yml': makeCompositeActionText(
        'attacker/exfiltrate@v1',
      ),
      '/repo/.github/actions/setup/action.yml': makeCompositeActionText(
        'actions/setup-node@v4',
      ),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.compositeActions.keys().toArray()).toStrictEqual(['setup'])
    expect(warn).toHaveBeenCalledExactlyOnceWith('Skipping invalid name: ..bad')
  })

  it.each([
    {
      path: '/repo/.github/actions/docs/README.md',
      entry: 'a directory without an action file',
      value: '# Actions\n',
    },
    {
      path: '/repo/.github/actions/README.md',
      value: '# Actions\n',
      entry: 'a file',
    },
    {
      value: fakeSymlink('/repo/.github/actions/removed'),
      path: '/repo/.github/actions/broken',
      entry: 'a broken symbolic link',
    },
  ])(
    'skips $entry in the actions directory and keeps the other actions',
    async ({ value, path }) => {
      installFileSystem({
        '/repo/.github/actions/setup/action.yml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
        [path]: value,
      })

      let result = await scanGitHubActions('/repo')

      expect(result.compositeActions.keys().toArray()).toStrictEqual(['setup'])
      expect(result.actions).toStrictEqual([
        {
          file: '/repo/.github/actions/setup/action.yml',
          uses: 'actions/setup-node@v4',
          ref: 'actions/setup-node@v4',
          name: 'actions/setup-node',
          type: 'external',
          version: 'v4',
          line: 6,
        },
      ])
    },
  )

  it.each([
    {
      workflowPath: '/srv/checkout/demo/.github/workflows/ci.yml',
      location: 'an absolute path',
      root: '/srv/checkout/demo',
    },
    {
      workflowPath: '/home/dev/work/demo/.github/workflows/ci.yml',
      location: 'a path inside the working directory',
      root: 'demo',
    },
    {
      workflowPath: '/home/dev/demo/.github/workflows/ci.yml',
      location: 'a path next to the working directory',
      root: '../demo',
    },
    {
      workflowPath: '/home/dev/work/.github/workflows/ci.yml',
      location: 'the working directory by default',
      root: undefined,
    },
  ])('scans the repository at $location', async ({ workflowPath, root }) => {
    vi.spyOn(process, 'cwd').mockReturnValue('/home/dev/work')
    installFileSystem({
      [workflowPath]: makeWorkflowText('actions/checkout@v4'),
    })

    let result = await scanGitHubActions(root)

    expect(result.workflows).toStrictEqual(
      new Map([
        [
          '.github/workflows/ci.yml',
          [
            {
              uses: 'actions/checkout@v4',
              ref: 'actions/checkout@v4',
              name: 'actions/checkout',
              file: workflowPath,
              type: 'external',
              version: 'v4',
              job: 'build',
              line: 7,
            },
          ],
        ],
      ]),
    )
  })

  it.each([
    {
      workflowFile: '/repo/.gitea/workflows/ci.yml',
      workflowKey: '.gitea/workflows/ci.yml',
      actionPath: '.gitea/actions/build',
      ciDirectory: '.gitea',
    },
    {
      workflowFile: '/repo/packages/app/.github/workflows/ci.yml',
      workflowKey: 'packages/app/.github/workflows/ci.yml',
      actionPath: 'packages/app/.github/actions/build',
      ciDirectory: 'packages/app/.github',
    },
  ])(
    'scans the workflows and actions of the $ciDirectory directory only',
    async ({ workflowFile, ciDirectory, workflowKey, actionPath }) => {
      installFileSystem({
        '/repo/packages/app/.github/actions/build/action.yml':
          makeCompositeActionText('actions/setup-node@v4'),
        '/repo/.github/actions/release/action.yml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
        '/repo/.gitea/actions/build/action.yml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
        '/repo/packages/app/.github/workflows/ci.yml': makeWorkflowText(
          'actions/checkout@v4',
        ),
        '/repo/.github/workflows/release.yml': makeWorkflowText(
          'actions/checkout@v4',
        ),
        '/repo/.gitea/workflows/ci.yml': makeWorkflowText(
          'actions/checkout@v4',
        ),
      })

      let result = await scanGitHubActions('/repo', ciDirectory)

      expect(result.workflows).toStrictEqual(
        new Map([
          [
            workflowKey,
            [
              {
                uses: 'actions/checkout@v4',
                ref: 'actions/checkout@v4',
                name: 'actions/checkout',
                file: workflowFile,
                type: 'external',
                version: 'v4',
                job: 'build',
                line: 7,
              },
            ],
          ],
        ]),
      )
      expect(result.compositeActions).toStrictEqual(
        new Map([['build', actionPath]]),
      )
    },
  )

  it('keeps every occurrence of an action used in several places', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'actions/checkout@v4',
        'actions/checkout@v4',
      ),
      '/repo/.github/workflows/release.yml': makeWorkflowText(
        'actions/checkout@v4',
      ),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions).toHaveLength(3)
    expect(result.actions).toStrictEqual(
      expect.arrayContaining([
        {
          file: '/repo/.github/workflows/ci.yml',
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
          job: 'build',
          line: 7,
        },
        {
          file: '/repo/.github/workflows/ci.yml',
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
          job: 'build',
          line: 8,
        },
        {
          file: '/repo/.github/workflows/release.yml',
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
          job: 'build',
          line: 7,
        },
      ]),
    )
  })

  it.each<{ githubRepository: string; files: FakeTree; source: string }>([
    {
      githubRepository: 'acme/demo',
      source: 'GITHUB_REPOSITORY',
      files: {},
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/other/fork.git',
          name: 'origin',
        }),
      },
      source: 'GITHUB_REPOSITORY over .git/config',
      githubRepository: 'acme/demo',
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo.git',
          name: 'origin',
        }),
      },
      githubRepository: UNSET_GITHUB_REPOSITORY,
      source: 'an https origin in .git/config',
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo',
          name: 'origin',
        }),
      },
      source: 'an https origin without the .git suffix',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'git@github.com:acme/demo.git',
          name: 'origin',
        }),
      },
      githubRepository: UNSET_GITHUB_REPOSITORY,
      source: 'an ssh origin in .git/config',
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo.git',
          name: 'upstream',
        }),
      },
      source: 'the only remote when it is not called origin',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig(
          { url: 'https://github.com/other/fork.git', name: 'upstream' },
          { url: 'https://github.com/acme/demo.git', name: 'origin' },
        ),
      },
      source: 'origin when another remote is listed first',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': [
          '[remote "upstream"]',
          '\turl = https://github.com/other/fork.git',
          '[remote "origin"]',
          '\turl=https://github.com/acme/demo.git',
          '',
        ].join('\n'),
      },
      source:
        'an origin url without spaces around = when another remote is listed first',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': [
          '[remote "upstream"]',
          '\turl = https://github.com/other/fork.git',
          '[remote "origin"]',
          '\tfetch = +refs/heads/*:refs/remotes/origin/*',
          '\turl = https://github.com/acme/demo.git',
          '',
        ].join('\n'),
      },
      source:
        'an origin whose fetch line comes before its url when another remote is listed first',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo.git  ',
          name: 'origin',
        }),
      },
      source: 'an origin url followed by trailing blanks',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': [
          '[remote "upstream"]',
          '\turl=https://github.com/acme/demo.git',
          '',
        ].join('\n'),
      },
      source: 'a remote url without spaces around = when there is no origin',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo.git  ',
          name: 'upstream',
        }),
      },
      source:
        'a remote url followed by trailing blanks when there is no origin',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo.git',
          name: 'origin',
        }),
      },
      source: '.git/config when GITHUB_REPOSITORY is not an owner/repo pair',
      githubRepository: 'acme/demo/extra',
    },
  ])(
    'follows a same-repo composite action when the repository comes from $source',
    async ({ githubRepository, files }) => {
      vi.stubEnv('GITHUB_REPOSITORY', githubRepository)
      arrangeRepoWithSharedSetup(files)

      let result = await scanGitHubActions('/repo')

      expect(result.actions).toStrictEqual([
        makeSharedSetupReference(),
        makeSharedSetupStep(),
      ])
    },
  )

  it.each([
    { url: 'https://github.com/acme/acme.github.io.git', form: 'an https url' },
    { url: 'git@github.com:acme/acme.github.io.git', form: 'an ssh url' },
    {
      url: 'https://github.com/acme/acme.github.io',
      form: 'a url without the .git suffix',
    },
    {
      url: 'https://github.com/acme/acme.github.io/',
      form: 'a url with a trailing slash',
    },
  ])(
    'follows a same-repo composite action of a repository whose name has a dot, read from $form',
    async ({ url }) => {
      installFileSystem({
        '/repo/.github/workflows/ci.yml': makeWorkflowText(
          'acme/acme.github.io/tools/setup@v1',
        ),
        '/repo/tools/setup/action.yml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
        '/repo/.git/config': makeGitConfig({ name: 'origin', url }),
      })

      let result = await scanGitHubActions('/repo')

      expect(result.actions).toStrictEqual([
        makeSharedSetupReference({
          uses: 'acme/acme.github.io/tools/setup@v1',
          name: 'acme/acme.github.io/tools/setup',
          ref: 'acme/acme.github.io@v1',
        }),
        makeSharedSetupStep(),
      ])
    },
  )

  it.each<{ githubRepository: string; files: FakeTree; reason: string }>([
    {
      reason: 'the repository cannot be detected',
      githubRepository: UNSET_GITHUB_REPOSITORY,
      files: {},
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/acme/demo.git',
          name: 'origin',
        }),
      },
      reason: 'GITHUB_REPOSITORY names another repository',
      githubRepository: 'other/fork',
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://github.com/other/fork.git',
          name: 'origin',
        }),
      },
      reason: 'origin points to another repository',
      githubRepository: UNSET_GITHUB_REPOSITORY,
    },
    {
      files: {
        '/repo/.git/config': makeGitConfig({
          url: 'https://gitlab.com/acme/demo.git',
          name: 'origin',
        }),
      },
      githubRepository: UNSET_GITHUB_REPOSITORY,
      reason: 'origin is not hosted on GitHub',
    },
    {
      files: { '/repo/.git/config': makeGitConfig() },
      githubRepository: UNSET_GITHUB_REPOSITORY,
      reason: '.git/config declares no remote',
    },
  ])(
    'does not follow a same-repo composite action when $reason',
    async ({ githubRepository, files }) => {
      vi.stubEnv('GITHUB_REPOSITORY', githubRepository)
      arrangeRepoWithSharedSetup(files)

      let result = await scanGitHubActions('/repo')

      expect(result.actions).toStrictEqual([makeSharedSetupReference()])
    },
  )

  it.each<{ files: FakeTree; layout: string }>([
    {
      files: {
        '/repo/tools/setup/action.yaml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
      },
      layout: 'only an action.yaml',
    },
    {
      files: {
        '/repo/tools/setup/action.yaml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
        '/repo/tools/setup/action.yml': fakeDirectory(),
      },
      layout: 'an action.yaml next to an action.yml that is not a file',
    },
  ])(
    'follows a same-repo composite action whose directory holds $layout',
    async ({ files }) => {
      vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
      installFileSystem({
        '/repo/.github/workflows/ci.yml': makeWorkflowText(
          'acme/demo/tools/setup@v1',
        ),
        ...files,
      })

      let result = await scanGitHubActions('/repo')

      expect(result.actions).toStrictEqual([
        makeSharedSetupReference(),
        {
          file: '/repo/tools/setup/action.yaml',
          uses: 'actions/setup-node@v4',
          ref: 'actions/setup-node@v4',
          name: 'actions/setup-node',
          type: 'external',
          version: 'v4',
          line: 6,
        },
      ])
    },
  )

  it('does not follow a same-repo composite action whose action.yml and action.yaml are directories', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'acme/demo/tools/setup@v1',
      ),
      '/repo/tools/setup/action.yaml': fakeDirectory(),
      '/repo/tools/setup/action.yml': fakeDirectory(),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions).toStrictEqual([makeSharedSetupReference()])
  })

  it('follows nested same-repo composite actions, visiting each once when they reference each other', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
    installFileSystem({
      '/repo/composite/action.yml': makeCompositeActionText(
        'actions/setup-node@v4',
        'acme/demo/shared@v1',
      ),
      '/repo/shared/action.yml': makeCompositeActionText(
        'actions/cache@v4',
        'acme/demo/composite@v1',
      ),
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'acme/demo/composite@v1',
      ),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions.map(action => action.name).toSorted()).toStrictEqual([
      'acme/demo/composite',
      'acme/demo/composite',
      'acme/demo/shared',
      'actions/cache',
      'actions/setup-node',
    ])
  })

  it('keeps following the other same-repo composite actions when a referenced directory does not exist', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'acme/demo/missing@v1',
        'acme/demo/composite@v1',
      ),
      '/repo/composite/action.yml': makeCompositeActionText(
        'acme/demo/shared@v1',
      ),
      '/repo/shared/action.yml': makeCompositeActionText('actions/cache@v4'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions.map(action => action.name).toSorted()).toStrictEqual([
      'acme/demo/composite',
      'acme/demo/missing',
      'acme/demo/shared',
      'actions/cache',
    ])
  })

  it('adds nothing for a followed same-repo composite action that uses no actions', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
    installFileSystem({
      '/repo/release-notes/action.yml': [
        'name: Release notes',
        'description: Drafts release notes',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - run: ./scripts/release-notes.sh',
        '      shell: bash',
        '',
      ].join('\n'),
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'acme/demo/release-notes@v1',
      ),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions).toStrictEqual([
      {
        file: '/repo/.github/workflows/ci.yml',
        uses: 'acme/demo/release-notes@v1',
        name: 'acme/demo/release-notes',
        ref: 'acme/demo@v1',
        type: 'external',
        version: 'v1',
        job: 'build',
        line: 7,
      },
    ])
  })

  it('reports the steps of a local composite action once, without following its reference', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
    installFileSystem({
      '/repo/.github/actions/lint/action.yml': makeCompositeActionText(
        'actions/setup-python@v5',
      ),
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        './.github/actions/lint',
      ),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions.map(action => action.name).toSorted()).toStrictEqual([
      './.github/actions/lint',
      'actions/setup-python',
    ])
  })

  it('does not follow composite actions of another repository or outside the repository', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText(
        'other/tools/lint@v1',
        'acme/demo/../outside@v1',
      ),
      '/outside/action.yml': makeCompositeActionText(
        'actions/upload-artifact@v4',
      ),
      '/repo/lint/action.yml': makeCompositeActionText('acme/lint-rules@v2'),
    })

    let result = await scanGitHubActions('/repo')

    expect(result.actions.map(action => action.name)).toStrictEqual([
      'other/tools/lint',
      'acme/demo/../outside',
    ])
  })

  describe('current behavior pending owner decision', () => {
    it('records a composite action by its directory or by its file depending on where it is found and which scanner finds it', async () => {
      installFileSystem({
        '/repo/.github/actions/setup/action.yml': makeCompositeActionText(
          'actions/setup-node@v4',
        ),
        '/repo/action.yml': makeCompositeActionText('actions/cache@v4'),
      })

      let scanned = await scanGitHubActions('/repo')
      let scannedRecursively = await scanRecursive('/repo', '.')

      expect(scanned.compositeActions).toStrictEqual(
        new Map([
          ['setup', '.github/actions/setup'],
          ['action.yml', 'action.yml'],
        ]),
      )
      expect(scannedRecursively.compositeActions).toStrictEqual(
        new Map([
          ['.github/actions/setup', '.github/actions/setup/action.yml'],
          ['action.yml', 'action.yml'],
        ]),
      )
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it('keeps the actions scanned so far when ACTIONS_UP_TEST_THROW makes following same-repo composite actions fail', async () => {
      vi.stubEnv('GITHUB_REPOSITORY', 'acme/demo')
      vi.stubEnv('ACTIONS_UP_TEST_THROW', '1')
      arrangeRepoWithSharedSetup({})

      let result = await scanGitHubActions('/repo')

      expect(result).toStrictEqual({
        workflows: new Map([
          ['.github/workflows/ci.yml', [makeSharedSetupReference()]],
        ]),
        actions: [makeSharedSetupReference()],
        compositeActions: new Map(),
      })
    })
  })
})
