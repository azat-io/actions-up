import type { PathLike } from 'node:fs'

import { realpath, readFile, readdir } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FakeEntry } from '../../helpers/create-fake-file-system'

import {
  fakeUnreadableDirectory,
  createFakeFileSystem,
  fakeUnreadableFile,
  fakeDirectory,
  fakeSymlink,
} from '../../helpers/create-fake-file-system'
import { readWorkflowLockfile } from '../../../core/lockfile/read-workflow-lockfile'
import { traceLocalActions } from '../../../core/lockfile/trace-local-actions'
import { makeLockfileText } from '../../helpers/make-lockfile-text'

vi.mock(import('node:fs/promises'), () => ({
  realpath: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}))
vi.mock(import('../../../core/lockfile/trace-local-actions'))

/**
 * Definitions the tests let the tracked workflows of every lockfile reach: the
 * setup action of the repository.
 */
const REACHED = new Set(['/repo/.github/actions/setup/action.yml'])

const LOCKFILE_PATH = '/repo/.github/workflows/actions.lock'

/**
 * Serve `readFile`, `readdir` and `realpath` from an in-memory tree for the
 * running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: Record<string, FakeEntry | string>): void {
  let fileSystem = createFakeFileSystem(entries)
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
  vi.mocked<(path: PathLike) => Promise<string[]>>(readdir).mockImplementation(
    fileSystem.readdir,
  )
  vi.mocked(realpath).mockImplementation(path => fileSystem.realpath(path))
}

describe('readWorkflowLockfile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(traceLocalActions).mockResolvedValue(REACHED)
  })

  it('reads the workflows the lockfile tracks as absolute paths', async () => {
    installFileSystem({
      [LOCKFILE_PATH]: makeLockfileText({
        workflows: {
          '.github/workflows/release.yaml': [],
          '.github/workflows/ci.yml': [],
        },
      }),
      '/repo/.github/workflows/ci.yml': 'name: CI\n',
    })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile).toStrictEqual({
      workflows: new Set([
        '/repo/.github/workflows/release.yaml',
        '/repo/.github/workflows/ci.yml',
      ]),
      path: LOCKFILE_PATH,
      version: 'v0.0.3',
      reached: REACHED,
      root: '/repo',
    })
    expect(traceLocalActions).toHaveBeenCalledExactlyOnceWith(
      '/repo',
      new Set([
        '/repo/.github/workflows/release.yaml',
        '/repo/.github/workflows/ci.yml',
      ]),
    )
  })

  it('reports a repository without a lockfile as using none', async () => {
    installFileSystem({ '/repo/.github/workflows/ci.yml': 'name: CI\n' })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile).toBeNull()
  })

  it('reports a repository whose .github is not a directory as using none', async () => {
    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('ENOTDIR: not a directory'), { code: 'ENOTDIR' }),
    )

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile).toBeNull()
  })

  it('treats every workflow of .github/workflows as tracked when the lockfile names a version it does not know', async () => {
    installFileSystem({
      '/repo/.github/workflows/nested/ci.yml': 'name: Nested\n',
      '/repo/.github/workflows/release.yaml': 'name: Release\n',
      [LOCKFILE_PATH]: makeLockfileText({ version: 'v0.0.4' }),
      '/repo/.github/workflows/README.md': '# Workflows\n',
      '/repo/.github/workflows/ci.yml': 'name: CI\n',
    })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile).toStrictEqual({
      workflows: new Set([
        '/repo/.github/workflows/release.yaml',
        '/repo/.github/workflows/ci.yml',
      ]),
      error: 'unsupported schema version v0.0.4',
      path: LOCKFILE_PATH,
      version: 'v0.0.4',
      reached: REACHED,
      root: '/repo',
    })
  })

  it('treats every workflow as tracked when the lockfile cannot be parsed', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': 'name: CI\n',
      [LOCKFILE_PATH]: 'version: [\n',
    })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile).toStrictEqual({
      workflows: new Set(['/repo/.github/workflows/ci.yml']),
      error: 'invalid YAML',
      path: LOCKFILE_PATH,
      reached: REACHED,
      version: null,
      root: '/repo',
    })
  })

  it.each([
    { kind: 'a file that cannot be read', entry: fakeUnreadableFile() },
    { entry: fakeDirectory(), kind: 'a directory' },
  ])(
    'treats every workflow as tracked when the lockfile is $kind',
    async ({ entry }) => {
      installFileSystem({
        '/repo/.github/workflows/ci.yml': 'name: CI\n',
        [LOCKFILE_PATH]: entry,
      })

      let lockfile = await readWorkflowLockfile('/repo')

      expect(lockfile).toStrictEqual({
        workflows: new Set(['/repo/.github/workflows/ci.yml']),
        error: 'unreadable file',
        path: LOCKFILE_PATH,
        reached: REACHED,
        version: null,
        root: '/repo',
      })
    },
  )

  it('lets any workflow next to the lockfile be tracked, and any action be reached, when neither the lockfile nor its directory can be read', async () => {
    installFileSystem({
      '/repo/.github/workflows': fakeUnreadableDirectory(),
      [LOCKFILE_PATH]: fakeUnreadableFile(),
    })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile).toStrictEqual({
      error: 'unreadable file',
      path: LOCKFILE_PATH,
      workflows: null,
      version: null,
      reached: null,
      root: '/repo',
    })
    expect(traceLocalActions).not.toHaveBeenCalled()
  })

  it('names the lockfile by the real path of its directory', async () => {
    installFileSystem({
      '/repo/.github/workflows': fakeSymlink('/repo/config/workflows'),
      '/repo/config/workflows/actions.lock': makeLockfileText({}),
      [LOCKFILE_PATH]: makeLockfileText({}),
    })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile?.path).toBe('/repo/config/workflows/actions.lock')
  })

  it('names a tracked workflow by its real path', async () => {
    installFileSystem({
      [LOCKFILE_PATH]: makeLockfileText({
        workflows: { '.github/workflows/ci.yml': [] },
      }),
      '/repo/.github/workflows/ci.yml': fakeSymlink('/repo/ci/main.yml'),
      '/repo/ci/main.yml': 'name: CI\n',
    })

    let lockfile = await readWorkflowLockfile('/repo')

    expect(lockfile?.workflows).toStrictEqual(new Set(['/repo/ci/main.yml']))
    expect(traceLocalActions).toHaveBeenCalledExactlyOnceWith(
      '/repo',
      new Set(['/repo/ci/main.yml']),
    )
  })
})
