import type { PathLike } from 'node:fs'

import { realpath, readlink, readFile, stat } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FakeFileSystem } from '../../helpers/create-fake-file-system'
import type { WorkflowLockfile } from '../../../types/workflow-lockfile'
import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'
import type { ScanResult } from '../../../types/scan-result'

import {
  findRelockBlockers,
  planRelocks,
} from '../../../core/lockfile/plan-relocks'
import { readEnclosingLockfiles } from '../../../core/lockfile/read-enclosing-lockfiles'
import { traceLocalActions } from '../../../core/lockfile/trace-local-actions'
import { createFakeFileSystem } from '../../helpers/create-fake-file-system'
import { makeWorkflowLockfile } from '../../helpers/make-workflow-lockfile'
import { findRepositoryRoot } from '../../../core/fs/find-repository-root'
import { scanGitHubActions } from '../../../core/scan-github-actions'
import { scanRepository } from '../../../core/plan/scan-repository'
import { scanRecursive } from '../../../core/scan-recursive'

vi.mock(import('node:fs/promises'), () => ({
  realpath: vi.fn(),
  readlink: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}))
vi.mock(import('../../../core/lockfile/read-enclosing-lockfiles'))
vi.mock(import('../../../core/fs/find-repository-root'))
vi.mock(import('../../../core/scan-github-actions'))
vi.mock(import('../../../core/scan-recursive'))

const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

const SETUP_ACTION = '/repo/.github/actions/setup/action.yml'

/**
 * Lockfile of `/repo` that tracks its CI workflow, which runs the setup action
 * of the repository through `$/`.
 */
const LOCKFILE = makeWorkflowLockfile({
  reached: new Map([[SETUP_ACTION, new Map([[CI_WORKFLOW, true]])]]),
})

/**
 * Let every path be real except the paths through the given symbolic links, and
 * the given paths, and the paths below them, have no real path at all.
 *
 * @param links - Symbolic links mapped to the real paths they point to.
 * @param missing - Paths whose real path cannot be found.
 */
function arrangeRealPaths(
  links: Record<string, string> = {},
  missing: string[] = [],
): void {
  vi.mocked<(path: PathLike) => Promise<string>>(realpath).mockImplementation(
    path => {
      let key = String(path)
      if (
        missing.some(prefix => key === prefix || key.startsWith(`${prefix}/`))
      ) {
        return Promise.reject(
          Object.assign(new Error(`ENOENT: ${key}`), { code: 'ENOENT' }),
        )
      }
      let link = Object.keys(links).find(
        prefix => key === prefix || key.startsWith(`${prefix}/`),
      )
      return Promise.resolve(
        link === undefined ? key : `${links[link]}${key.slice(link.length)}`,
      )
    },
  )
}

/**
 * Entries of a scan of `/repo`: a step action and a runner label of the CI
 * workflow, a step action of the release workflow, a step of the setup action
 * and a step of the lint action, which no tracked workflow runs.
 *
 * @returns Fresh scan result.
 */
function makeScanResult(): ScanResult {
  let actions: GitHubAction[] = [
    { name: 'actions/checkout', file: CI_WORKFLOW, type: 'external' },
    { name: 'runner/ubuntu', file: CI_WORKFLOW, type: 'runner' },
    {
      file: '/repo/.github/workflows/release.yml',
      name: 'actions/setup-node',
      type: 'external',
    },
    { name: 'actions/cache', file: SETUP_ACTION, type: 'external' },
    {
      file: '/repo/tools/lint/action.yml',
      name: 'actions/cache',
      type: 'external',
    },
  ]
  return {
    workflows: new Map([['.github/workflows/ci.yml', actions.slice(0, 2)]]),
    compositeActions: new Map(),
    actions,
  }
}

/**
 * Let the given files be symbolic links, and every other path no link.
 *
 * @param links - Links mapped to the target each names, as written.
 */
function arrangeLinks(links: Record<string, string> = {}): void {
  vi.mocked<(path: PathLike) => Promise<string>>(readlink).mockImplementation(
    path => {
      let key = String(path)
      return Object.hasOwn(links, key) ?
          Promise.resolve(links[key]!)
        : Promise.reject(
            Object.assign(new Error(`EINVAL: ${key}`), { code: 'EINVAL' }),
          )
    },
  )
}

/**
 * Create the update the writer would write for a scanned action.
 *
 * @param action - Scanned action.
 * @returns Update to a newer version of the action.
 */
function makeUpdate(action: GitHubAction): ActionUpdate {
  return {
    latestSha: '11d5960a326750d5838078e36cf38b85af677262',
    latestVersion: 'v4.3.1',
    currentVersion: 'v4',
    targetRef: 'v4.3.1',
    publishedAt: null,
    isBreaking: false,
    hasUpdate: true,
    status: 'ok',
    action,
  }
}

/**
 * Text of a workflow whose job checks the repository out, then runs one step
 * per reference.
 *
 * @param references - References of the steps after the checkout.
 * @returns Workflow YAML text.
 */
function makeWorkflowText(...references: string[]): string {
  return [
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ...references.map(reference => `      - uses: ${reference}`),
    '',
  ].join('\n')
}

/**
 * Text of an action of the repository with one step per reference.
 *
 * @param using - Kind of the action, as its definition writes it.
 * @param references - References of the steps.
 * @returns Action YAML text.
 */
function makeActionText(using: string, ...references: string[]): string {
  return [
    'runs:',
    `  using: ${using}`,
    '  steps:',
    ...references.map(reference => `    - uses: ${reference}`),
    '',
  ].join('\n')
}

describe('scanRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(findRepositoryRoot).mockResolvedValue('/repo')
    vi.mocked(scanGitHubActions).mockResolvedValue(makeScanResult())
    vi.mocked(scanRecursive).mockResolvedValue(makeScanResult())
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([LOCKFILE])
    arrangeRealPaths()
    arrangeLinks()
  })

  it('lists an action of the repository the workflows run only through ./ without workflows to relock for it', async () => {
    let local = makeWorkflowLockfile({
      reached: new Map([[SETUP_ACTION, new Map([[CI_WORKFLOW, false]])]]),
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([local])

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles.get(SETUP_ACTION)).toStrictEqual([
      { lockfile: local, workflows: null },
    ])
  })

  it('lists an action of the repository without workflows to relock for it when one workflow runs it through $/ and another only through ./', async () => {
    let release = '/repo/.github/workflows/release.yml'
    let mixed = makeWorkflowLockfile({
      reached: new Map([
        [
          SETUP_ACTION,
          new Map([
            [CI_WORKFLOW, true],
            [release, false],
          ]),
        ],
      ]),
      keys: new Map([
        ['.github/workflows/release.yml', release],
        ['.github/workflows/ci.yml', CI_WORKFLOW],
      ]),
      workflows: new Set([CI_WORKFLOW, release]),
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([mixed])

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles.get(SETUP_ACTION)).toStrictEqual([
      { lockfile: mixed, workflows: null },
    ])
    expect(lockedFiles.get(CI_WORKFLOW)).toStrictEqual([
      { workflows: ['.github/workflows/ci.yml'], lockfile: mixed },
    ])
  })

  it('lists a workflow that runs remote actions through ./ alone, and the actions it runs through $/, without workflows to relock for them', async () => {
    let release = '/repo/.github/workflows/release.yml'
    let lint = '/repo/tools/lint/action.yml'
    let local = makeWorkflowLockfile({
      reached: new Map([
        [
          SETUP_ACTION,
          new Map([
            [CI_WORKFLOW, true],
            [release, true],
          ]),
        ],
        [lint, new Map([[release, false]])],
      ]),
      keys: new Map([
        ['.github/workflows/release.yml', release],
        ['.github/workflows/ci.yml', CI_WORKFLOW],
      ]),
      workflows: new Set([CI_WORKFLOW, release]),
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([local])

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles).toStrictEqual(
      new Map([
        [
          CI_WORKFLOW,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: local }],
        ],
        [SETUP_ACTION, [{ lockfile: local, workflows: null }]],
        [release, [{ lockfile: local, workflows: null }]],
        [lint, [{ lockfile: local, workflows: null }]],
      ]),
    )
  })

  it('relocks no workflow that runs through ./ an action the repository does not hold, since it may run any remote action', async () => {
    let absent = makeWorkflowLockfile({
      reached: new Map([
        ['/repo/tools/action.yml', new Map([[CI_WORKFLOW, false]])],
      ]),
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([absent])

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles.get(CI_WORKFLOW)).toStrictEqual([
      { lockfile: absent, workflows: null },
    ])
    expect(findRelockBlockers(lockedFiles).get(CI_WORKFLOW)).toBe('unrecorded')
  })

  it('relocks no workflow of a lockfile whose workflows cannot all be traced, since any of them may run remote actions through ./', async () => {
    let untraced = makeWorkflowLockfile({ reached: null })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([untraced])

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles.get(CI_WORKFLOW)).toStrictEqual([
      { lockfile: untraced, workflows: null },
    ])
    expect(findRelockBlockers(lockedFiles)).toStrictEqual(
      new Map([
        ['/repo/tools/lint/action.yml', 'unreadable'],
        [SETUP_ACTION, 'unreadable'],
        [CI_WORKFLOW, 'unreadable'],
      ]),
    )
  })

  describe('with a lockfile traced from the files of the repository', () => {
    /**
     * Setup action of the repository, which runs a remote action.
     */
    let setup = makeActionText('composite', 'actions/setup-node@v4')

    /**
     * Trace the CI workflow through the given files, and let the scan find the
     * checkout of the CI workflow and the remote action of the setup action,
     * next to the lockfile the trace makes.
     *
     * @param files - Absolute paths of the files of the repository mapped to
     *   their text.
     * @returns The lockfile.
     */
    async function arrangeRepository(
      files: Record<string, string>,
    ): Promise<WorkflowLockfile> {
      let fileSystem = createFakeFileSystem(files)
      vi.mocked(readFile).mockImplementation((path, options) =>
        fileSystem.readFile(path as PathLike, options),
      )
      vi.mocked<FakeFileSystem['stat']>(stat).mockImplementation(
        fileSystem.stat,
      )
      let lockfile = makeWorkflowLockfile(
        await traceLocalActions('/repo', new Set([CI_WORKFLOW])),
      )
      let actions: GitHubAction[] = [
        { name: 'actions/checkout', file: CI_WORKFLOW, type: 'external' },
        { name: 'actions/setup-node', file: SETUP_ACTION, type: 'external' },
      ]
      vi.mocked(scanGitHubActions).mockResolvedValue({
        workflows: new Map([['.github/workflows/ci.yml', actions.slice(0, 1)]]),
        compositeActions: new Map(),
        actions,
      })
      vi.mocked(readEnclosingLockfiles).mockResolvedValue([lockfile])
      return lockfile
    }

    it('relocks the workflow for itself and for the action it runs through $/ alone', async () => {
      let lockfile = await arrangeRepository({
        [CI_WORKFLOW]: makeWorkflowText('$/.github/actions/setup'),
        [SETUP_ACTION]: setup,
      })

      let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })
      let updates = scanResult.actions.map(action => makeUpdate(action))

      expect(findRelockBlockers(lockedFiles)).toStrictEqual(new Map())
      expect(planRelocks(lockedFiles, updates)).toStrictEqual([
        {
          files: new Map([
            [SETUP_ACTION, ['.github/workflows/ci.yml']],
            [CI_WORKFLOW, ['.github/workflows/ci.yml']],
          ]),
          workflows: ['.github/workflows/ci.yml'],
          lockfile,
          updates,
        },
      ])
    })

    it.each<{ files: Record<string, string>; layout: string }>([
      {
        files: {
          [CI_WORKFLOW]: makeWorkflowText(
            './.github/actions/setup',
            '$/.github/actions/setup',
          ),
        },
        layout: 'runs the setup action through ./ as well as through $/',
      },
      {
        files: {
          '/repo/.github/actions/build/action.yml': makeActionText(
            'composite',
            './.github/actions/setup',
          ),
          [CI_WORKFLOW]: makeWorkflowText(
            '$/.github/actions/build',
            '$/.github/actions/setup',
          ),
        },
        layout:
          'runs the setup action through $/, along with a build action that runs it through ./',
      },
      {
        files: {
          [CI_WORKFLOW]: makeWorkflowText(
            './../outside',
            '$/.github/actions/setup',
          ),
        },
        layout: 'runs through ./ an action outside the repository',
      },
      {
        files: {
          [CI_WORKFLOW]: makeWorkflowText(
            '../outside',
            '$/.github/actions/setup',
          ),
        },
        layout: 'runs through ../ an action outside the repository',
      },
      {
        files: {
          [SETUP_ACTION]: makeActionText('Composite', 'actions/setup-node@v4'),
          [CI_WORKFLOW]: makeWorkflowText('$/.github/actions/setup'),
        },
        layout:
          'runs through $/ a composite action whose kind is not written in lower case',
      },
    ])(
      'skips the locked updates of a workflow that $layout as unrecorded and relocks nothing',
      async ({ files }) => {
        await arrangeRepository({ [SETUP_ACTION]: setup, ...files })

        let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })

        expect(findRelockBlockers(lockedFiles)).toStrictEqual(
          new Map([
            [SETUP_ACTION, 'unrecorded'],
            [CI_WORKFLOW, 'unrecorded'],
          ]),
        )
        expect(
          planRelocks(
            lockedFiles,
            scanResult.actions.map(action => makeUpdate(action)),
          ),
        ).toStrictEqual([])
      },
    )
  })

  it('lists a tracked workflow that no key of the lockfile names without workflows to relock for it, so that no relock runs without paths', async () => {
    let unnamed = makeWorkflowLockfile({ keys: new Map() })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([unnamed])

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles.get(CI_WORKFLOW)).toStrictEqual([
      { lockfile: unnamed, workflows: null },
    ])
  })

  it('marks the actions of the tracked workflows and of the actions they run as locked', async () => {
    let { lockedFiles, scanResult, lockfiles } = await scanRepository({
      cwd: '/repo',
    })

    expect(lockfiles).toStrictEqual([LOCKFILE])
    expect(lockedFiles).toStrictEqual(
      new Map([
        [
          SETUP_ACTION,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
        ],
        [
          CI_WORKFLOW,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
        ],
      ]),
    )
    expect(
      scanResult.actions.map(({ locked, name, file }) => ({
        locked,
        name,
        file,
      })),
    ).toStrictEqual([
      { name: 'actions/checkout', file: CI_WORKFLOW, locked: true },
      { name: 'runner/ubuntu', file: CI_WORKFLOW, locked: undefined },
      {
        file: '/repo/.github/workflows/release.yml',
        name: 'actions/setup-node',
        locked: undefined,
      },
      { name: 'actions/cache', file: SETUP_ACTION, locked: true },
      {
        file: '/repo/tools/lint/action.yml',
        name: 'actions/cache',
        locked: undefined,
      },
    ])
    expect(
      scanResult.workflows
        .values()
        .toArray()
        .flat()
        .map(action => action.locked),
    ).toStrictEqual([true, undefined])
  })

  it('marks an action of a definition that is a symbolic link to one a tracked workflow runs, and relocks that workflow for it', async () => {
    let alias = '/repo/.github/actions/setup-legacy/action.yml'
    vi.mocked(scanGitHubActions).mockResolvedValue({
      ...makeScanResult(),
      actions: [{ name: 'actions/cache', type: 'external', file: alias }],
    })
    arrangeLinks({ [alias]: '../setup/action.yml' })

    let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })

    expect(scanResult.actions).toStrictEqual([
      { name: 'actions/cache', type: 'external', locked: true, file: alias },
    ])
    expect(lockedFiles).toStrictEqual(
      new Map([
        [
          alias,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
        ],
      ]),
    )
    expect(readEnclosingLockfiles).toHaveBeenCalledExactlyOnceWith(
      new Set([
        '/repo/.github/actions/setup-legacy',
        '/repo/.github/actions/setup',
      ]),
    )
  })

  describe('next to a lockfile whose workflows cannot be listed', () => {
    /**
     * Lockfile of `/repo` that cannot be read, next to workflows that cannot be
     * listed either.
     */
    let unlisted = makeWorkflowLockfile({
      error: 'unreadable file',
      workflows: null,
      reached: null,
      version: null,
      keys: null,
    })

    /**
     * Let the scan find one step action of the given file.
     *
     * @param file - File the scan finds the action in.
     */
    function arrangeFile(file: string): void {
      vi.mocked(scanGitHubActions).mockResolvedValue({
        ...makeScanResult(),
        actions: [{ name: 'actions/checkout', type: 'external', file }],
      })
      vi.mocked(readEnclosingLockfiles).mockResolvedValue([unlisted])
    }

    it('marks a workflow there that is a symbolic link to a file elsewhere', async () => {
      arrangeFile(CI_WORKFLOW)
      arrangeLinks({ [CI_WORKFLOW]: '../../ci/main.yml' })

      let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })

      expect(scanResult.actions.map(action => action.locked)).toStrictEqual([
        true,
      ])
      expect(lockedFiles).toStrictEqual(
        new Map([[CI_WORKFLOW, [{ lockfile: unlisted, workflows: null }]]]),
      )
    })

    it('marks a file that leads through a workflow there to a file elsewhere', async () => {
      arrangeFile('/repo/aliases/ci.yml')
      arrangeLinks({
        '/repo/aliases/ci.yml': '../.github/workflows/ci.yml',
        [CI_WORKFLOW]: '../../ci/main.yml',
      })

      let { scanResult } = await scanRepository({ cwd: '/repo' })

      expect(scanResult.actions.map(action => action.locked)).toStrictEqual([
        true,
      ])
      expect(readEnclosingLockfiles).toHaveBeenCalledExactlyOnceWith(
        new Set(['/repo/.github/workflows', '/repo/aliases', '/repo/ci']),
      )
    })

    it('stops following symbolic links that lead in a circle', async () => {
      arrangeFile('/repo/aliases/a.yml')
      arrangeLinks({
        '/repo/aliases/a.yml': 'b.yml',
        '/repo/aliases/b.yml': 'a.yml',
      })

      let { scanResult } = await scanRepository({ cwd: '/repo' })

      expect(scanResult.actions.map(action => action.locked)).toStrictEqual([
        undefined,
      ])
      expect(readlink).toHaveBeenCalledTimes(41)
    })
  })

  it('reads the lockfiles that enclose the real directories of the scanned files', async () => {
    await scanRepository({ cwd: '/repo' })

    expect(readEnclosingLockfiles).toHaveBeenCalledExactlyOnceWith(
      new Set([
        '/repo/.github/actions/setup',
        '/repo/.github/workflows',
        '/repo/tools/lint',
      ]),
    )
  })

  it('marks nothing when no lockfile encloses the scanned files', async () => {
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([])

    let { lockedFiles, scanResult, lockfiles } = await scanRepository({
      cwd: '/repo',
    })

    expect(lockfiles).toStrictEqual([])
    expect(lockedFiles).toStrictEqual(new Map())
    expect(scanResult.actions.some(action => action.locked)).toBe(false)
  })

  it('marks an action that any of the lockfiles pins', async () => {
    let release = '/repo/.github/workflows/release.yml'
    let other = makeWorkflowLockfile({
      keys: new Map([['.github/workflows/release.yml', release]]),
      workflows: new Set([release]),
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([other, LOCKFILE])

    let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })

    expect(scanResult.actions.map(action => action.locked)).toStrictEqual([
      true,
      undefined,
      true,
      true,
      undefined,
    ])
    expect(lockedFiles).toStrictEqual(
      new Map([
        [
          SETUP_ACTION,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
        ],
        [
          CI_WORKFLOW,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
        ],
        [
          release,
          [{ workflows: ['.github/workflows/release.yml'], lockfile: other }],
        ],
      ]),
    )
  })

  it('lists a file with every lockfile that pins it, once for all its actions', async () => {
    let second = makeWorkflowLockfile({ path: '/repo/second/actions.lock' })
    vi.mocked(scanGitHubActions).mockResolvedValue({
      ...makeScanResult(),
      actions: [
        { name: 'actions/checkout', file: CI_WORKFLOW, type: 'external' },
        { name: 'actions/setup-node', file: CI_WORKFLOW, type: 'external' },
      ],
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([LOCKFILE, second])

    let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })

    expect(scanResult.actions.map(action => action.locked)).toStrictEqual([
      true,
      true,
    ])
    expect(lockedFiles).toStrictEqual(
      new Map([
        [
          CI_WORKFLOW,
          [
            { workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE },
            { workflows: ['.github/workflows/ci.yml'], lockfile: second },
          ],
        ],
      ]),
    )
  })

  it('matches a file found through a symbolic link by its real path, keeping its spelling', async () => {
    let link = '/home/me/repo/.github/workflows'
    vi.mocked(scanGitHubActions).mockResolvedValue({
      ...makeScanResult(),
      actions: [
        { name: 'actions/checkout', file: `${link}/ci.yml`, type: 'external' },
        { file: '/gone/action.yml', name: 'actions/cache', type: 'external' },
      ],
    })
    arrangeRealPaths({ [link]: '/repo/.github/workflows' }, ['/gone'])

    let { lockedFiles, scanResult } = await scanRepository({
      cwd: '/home/me/repo',
    })

    expect(lockedFiles).toStrictEqual(
      new Map([
        [
          `${link}/ci.yml`,
          [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
        ],
      ]),
    )
    expect(readEnclosingLockfiles).toHaveBeenCalledExactlyOnceWith(
      new Set(['/repo/.github/workflows', '/gone']),
    )
    expect(scanResult.actions).toStrictEqual([
      {
        name: 'actions/checkout',
        file: `${link}/ci.yml`,
        type: 'external',
        locked: true,
      },
      { file: '/gone/action.yml', name: 'actions/cache', type: 'external' },
    ])
  })

  it('follows a relative link from the real directory it is in, not from the linked directory it was found through', async () => {
    let shared = '/repo/shared/ci.yml'
    let lockfile = makeWorkflowLockfile({
      keys: new Map([['.github/workflows/ci.yml', shared]]),
      path: '/repo/config/github/workflows/actions.lock',
      workflows: new Set([shared]),
    })
    vi.mocked(scanGitHubActions).mockResolvedValue({
      ...makeScanResult(),
      actions: [
        { name: 'actions/checkout', file: CI_WORKFLOW, type: 'external' },
      ],
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([lockfile])
    arrangeRealPaths({ '/repo/.github': '/repo/config/github' })
    arrangeLinks({ [CI_WORKFLOW]: '../../../shared/ci.yml' })

    let { lockedFiles, scanResult } = await scanRepository({ cwd: '/repo' })

    expect(readEnclosingLockfiles).toHaveBeenCalledExactlyOnceWith(
      new Set(['/repo/config/github/workflows', '/repo/shared']),
    )
    expect(scanResult.actions.map(action => action.locked)).toStrictEqual([
      true,
    ])
    expect(lockedFiles).toStrictEqual(
      new Map([
        [CI_WORKFLOW, [{ workflows: ['.github/workflows/ci.yml'], lockfile }]],
      ]),
    )
  })

  it('lists a tracked workflow that is a symbolic link under the key the lockfile names it by', async () => {
    let lockfile = makeWorkflowLockfile({
      keys: new Map([['.github/workflows/ci.yml', '/repo/ci/main.yml']]),
      workflows: new Set(['/repo/ci/main.yml']),
    })
    vi.mocked(scanGitHubActions).mockResolvedValue({
      ...makeScanResult(),
      actions: [
        { name: 'actions/checkout', file: CI_WORKFLOW, type: 'external' },
      ],
    })
    vi.mocked(readEnclosingLockfiles).mockResolvedValue([lockfile])
    arrangeLinks({ [CI_WORKFLOW]: '../../ci/main.yml' })

    let { lockedFiles } = await scanRepository({ cwd: '/repo' })

    expect(lockedFiles).toStrictEqual(
      new Map([
        [CI_WORKFLOW, [{ workflows: ['.github/workflows/ci.yml'], lockfile }]],
      ]),
    )
  })

  it('looks up no repository root in recursive mode, scanning from the working directory', async () => {
    await scanRepository({ cwd: '/repo/packages/app', recursive: true })

    expect(findRepositoryRoot).not.toHaveBeenCalled()
    expect(scanRecursive).toHaveBeenCalledExactlyOnceWith(
      '/repo/packages/app',
      '.',
    )
  })

  it('leaves an entry without a file unmarked', async () => {
    vi.mocked(scanGitHubActions).mockResolvedValue({
      ...makeScanResult(),
      actions: [{ name: 'actions/checkout', type: 'external' }],
    })

    let { scanResult } = await scanRepository({ cwd: '/repo' })

    expect(scanResult.actions).toStrictEqual([
      { name: 'actions/checkout', type: 'external' },
    ])
    expect(readEnclosingLockfiles).toHaveBeenCalledExactlyOnceWith(new Set())
  })
})
