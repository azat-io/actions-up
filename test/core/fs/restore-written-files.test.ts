import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'

import type { FakeFileSystem } from '../../helpers/create-fake-file-system'

import { restoreWrittenFiles } from '../../../core/fs/restore-written-files'
import { createFakeFileSystem } from '../../helpers/create-fake-file-system'

vi.mock(import('node:fs/promises'), () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
}))

const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

const RELEASE_WORKFLOW = '/repo/.github/workflows/release.yml'

const LINT_WORKFLOW = '/repo/.github/workflows/lint.yml'

/**
 * Serve files from an in-memory file system through `node:fs/promises`.
 *
 * @param files - Absolute paths mapped to file text.
 * @returns File system holding what is written back.
 */
function installFiles(files: Record<string, string>): FakeFileSystem {
  let fileSystem = createFakeFileSystem(files)
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
  vi.mocked(writeFile).mockImplementation((path, content) =>
    fileSystem.writeFile(path as PathLike, content as string),
  )
  return fileSystem
}

describe('restoreWrittenFiles', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('puts back a file that still holds what was written, and leaves one changed since', async () => {
    let fileSystem = installFiles({
      [RELEASE_WORKFLOW]: 'uses: actions/checkout@v5 # edited by hand\n',
      [CI_WORKFLOW]: 'uses: actions/checkout@v5\n',
    })

    let result = await restoreWrittenFiles([
      {
        before: 'uses: actions/checkout@v4\n',
        after: 'uses: actions/checkout@v5\n',
        path: RELEASE_WORKFLOW,
      },
      {
        before: 'uses: actions/checkout@v4\n',
        after: 'uses: actions/checkout@v5\n',
        path: CI_WORKFLOW,
      },
    ])

    expect(result).toStrictEqual([CI_WORKFLOW])
    expect(fileSystem.contentOf(CI_WORKFLOW)).toBe(
      'uses: actions/checkout@v4\n',
    )
    expect(fileSystem.contentOf(RELEASE_WORKFLOW)).toBe(
      'uses: actions/checkout@v5 # edited by hand\n',
    )
  })

  it('leaves a file that is gone, and one that cannot be written back, saying why', async () => {
    let consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    installFiles({
      [LINT_WORKFLOW]: 'uses: actions/checkout@v5\n',
      [CI_WORKFLOW]: 'uses: actions/checkout@v5\n',
    })
    vi.mocked(writeFile)
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
      .mockRejectedValueOnce('disk full')

    let result = await restoreWrittenFiles([
      {
        before: 'uses: actions/checkout@v4\n',
        after: 'uses: actions/checkout@v5\n',
        path: RELEASE_WORKFLOW,
      },
      {
        before: 'uses: actions/checkout@v4\n',
        after: 'uses: actions/checkout@v5\n',
        path: CI_WORKFLOW,
      },
      {
        before: 'uses: actions/checkout@v4\n',
        after: 'uses: actions/checkout@v5\n',
        path: LINT_WORKFLOW,
      },
    ])

    expect(result).toStrictEqual([])
    expect(consoleError.mock.calls).toStrictEqual([
      [`Could not put back ${CI_WORKFLOW}: EACCES: permission denied`],
      [`Could not put back ${LINT_WORKFLOW}: disk full`],
    ])
  })

  it('leaves a file whose bytes differ from what was written, even when they read as the same text', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0xff]))

    let result = await restoreWrittenFiles([
      {
        before: 'uses: actions/checkout@v4\n',
        after: Buffer.from([0xff]).toString(),
        path: CI_WORKFLOW,
      },
    ])

    expect(result).toStrictEqual([])
    expect(writeFile).not.toHaveBeenCalled()
  })
})
