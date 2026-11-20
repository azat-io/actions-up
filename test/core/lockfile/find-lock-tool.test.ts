import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stat } from 'node:fs/promises'

import { createFakeFileSystem } from '../../helpers/create-fake-file-system'
import { findLockTool } from '../../../core/lockfile/find-lock-tool'
import { makeGhResult } from '../../helpers/make-gh-result'
import { runGh } from '../../../core/lockfile/run-gh'

vi.mock(import('node:fs/promises'), () => ({
  stat: vi.fn(),
}))
vi.mock(import('../../../core/lockfile/run-gh'))

/**
 * Line of another extension in the list of installed extensions.
 */
const OTHER_EXTENSION = ['gh notes', 'octocat/gh-notes', 'v1.2.0'].join('\t')

/**
 * List of installed extensions as `gh` writes it to a pipe, with
 * gh-actions-lock of the given version among them.
 *
 * @param version - Listed version of gh-actions-lock.
 * @returns Output of `gh extension list`.
 */
function listWith(version: string): string {
  return [
    OTHER_EXTENSION,
    ['gh actions-lock', 'github/gh-actions-lock', version].join('\t'),
    '',
  ].join('\n')
}

describe('findLockTool', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it.each([
    ['the first release that takes every flag the relock passes', 'v0.3.0'],
    ['a later release', 'v0.4.1'],
    ['a build from source, which lists no release', ''],
    ['an install pinned to a commit', '8bb4bb6'],
  ])('finds %s', async (_description, version) => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ stdout: listWith(version) }),
    )

    await expect(findLockTool('/repo')).resolves.toBe('available')
    expect(runGh).toHaveBeenCalledExactlyOnceWith(['extension', 'list'], {
      timeout: 30_000,
      cwd: '/repo',
    })
  })

  it('reports the GitHub CLI missing when no gh is found', async () => {
    vi.mocked(stat).mockImplementation(
      createFakeFileSystem({ '/repo': { kind: 'directory' } }).stat,
    )
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ startError: 'ENOENT', exitCode: null, started: false }),
    )

    await expect(findLockTool('/repo')).resolves.toBe('no-gh')
  })

  it('does not ask to install gh when the working directory is gone', async () => {
    vi.mocked(stat).mockImplementation(createFakeFileSystem({}).stat)
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ startError: 'ENOENT', exitCode: null, started: false }),
    )

    await expect(findLockTool('/repo')).resolves.toBe('unlisted')
  })

  it.each([
    ['without the permission to run it', 'EACCES'],
    ['as a script without a shebang line', 'ENOEXEC'],
    ['for a reason without a code', null],
  ])(
    'does not ask to install a gh that could not be started %s',
    async (_description, startError) => {
      vi.mocked(runGh).mockResolvedValue(
        makeGhResult({ exitCode: null, started: false, startError }),
      )

      await expect(findLockTool('/repo')).resolves.toBe('unlisted')
    },
  )

  it('reports a list that did not finish', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ signal: 'SIGTERM', exitCode: null }),
    )

    await expect(findLockTool('/repo')).resolves.toBe('unlisted')
  })

  it.each([
    ['it is not listed', makeGhResult({ stdout: `${OTHER_EXTENSION}\n` })],
    [
      'the list fails, as before 2.10 without extensions',
      makeGhResult({ stderr: 'no extensions installed\n', exitCode: 1 }),
    ],
  ])('reports the extension missing when %s', async (_description, list) => {
    vi.mocked(runGh).mockResolvedValue(list)

    await expect(findLockTool('/repo')).resolves.toBe('missing')
  })

  it('reports a release older than the relock needs as outdated', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ stdout: listWith('v0.2.0') }),
    )

    await expect(findLockTool('/repo')).resolves.toBe('outdated')
  })

  it('reads a listed extension without a version as a build from source', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({
        stdout: `${['gh actions-lock', '/home/me/gh-actions-lock'].join('\t')}\n`,
      }),
    )

    await expect(findLockTool('/repo')).resolves.toBe('available')
  })
})
