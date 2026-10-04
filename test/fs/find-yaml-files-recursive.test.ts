import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdir, lstat } from 'node:fs/promises'

import type { FakeEntry } from '../helpers/create-fake-file-system'

import {
  fakeUnreadableDirectory,
  createFakeFileSystem,
  fakeDirectory,
  fakeSymlink,
} from '../helpers/create-fake-file-system'
import { findYamlFilesRecursive } from '../../core/fs/find-yaml-files-recursive'

vi.mock(import('node:fs/promises'), () => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
}))

/**
 * `readdir` narrowed to the overload the walker calls, which lists entry names.
 */
let mockedReaddir = vi.mocked<(path: PathLike) => Promise<string[]>>(readdir)

/**
 * Serve `readdir` and `lstat` from an in-memory tree for the running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: Record<string, FakeEntry | string>): void {
  let fileSystem = createFakeFileSystem(entries)
  mockedReaddir.mockImplementation(fileSystem.readdir)
  vi.mocked(lstat).mockImplementation(fileSystem.lstat)
}

describe('findYamlFilesRecursive', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('finds YAML files in the directory and in all its subdirectories', async () => {
    installFileSystem({
      '/repo/.github/workflows/deploy/release.yaml': 'on: push\n',
      '/repo/.github/workflows/build.sh': 'pnpm build\n',
      '/repo/.github/workflows/ci.yml': 'on: push\n',
      '/repo/.github/dependabot.yml': 'version: 2\n',
      '/repo/.github/README.md': '# CI\n',
    })

    let files = await findYamlFilesRecursive('/repo/.github')

    expect(files.toSorted()).toStrictEqual([
      '/repo/.github/dependabot.yml',
      '/repo/.github/workflows/ci.yml',
      '/repo/.github/workflows/deploy/release.yaml',
    ])
  })

  it('returns an empty list when the tree holds no YAML files', async () => {
    installFileSystem({
      '/repo/docs/assets': fakeDirectory(),
      '/repo/docs/guide.md': '# Guide\n',
    })

    let files = await findYamlFilesRecursive('/repo/docs')

    expect(files).toStrictEqual([])
  })

  it('skips symbolic links to files and to directories', async () => {
    installFileSystem({
      '/repo/.github/linked-workflows': fakeSymlink('/shared/workflows'),
      '/repo/.github/release.yml': fakeSymlink('/shared/release.yml'),
      '/shared/workflows/deploy.yml': 'on: push\n',
      '/repo/.github/ci.yml': 'on: push\n',
      '/shared/release.yml': 'on: push\n',
    })

    let files = await findYamlFilesRecursive('/repo/.github')

    expect(files).toStrictEqual(['/repo/.github/ci.yml'])
  })

  it('does not walk the directory when it is itself a symbolic link', async () => {
    installFileSystem({ '/repo/.github/ci.yml': 'on: push\n' })
    let linkStats = await createFakeFileSystem({
      '/repo/.github': fakeSymlink('/shared/.github'),
    }).lstat('/repo/.github')
    /**
     * The fake resolves a symbolic link only in the last path component, so
     * entries below a linked directory would not be found through it. Only the
     * first `lstat` call, the one for the walked directory, answers "symbolic
     * link"; the walk would find `ci.yml` if it went on.
     */
    vi.mocked(lstat).mockResolvedValueOnce(linkStats)

    let files = await findYamlFilesRecursive('/repo/.github')

    expect(files).toStrictEqual([])
  })

  it('keeps scanning when a subdirectory cannot be read', async () => {
    installFileSystem({
      '/repo/.github/workflows/release.yaml': 'on: push\n',
      '/repo/.github/private': fakeUnreadableDirectory(),
      '/repo/.github/workflows/ci.yml': 'on: push\n',
    })

    let files = await findYamlFilesRecursive('/repo/.github')

    expect(files.toSorted()).toStrictEqual([
      '/repo/.github/workflows/ci.yml',
      '/repo/.github/workflows/release.yaml',
    ])
  })

  describe('defensive branches unreachable through the public API', () => {
    it('does not walk a directory again when a listing leads back to it', async () => {
      installFileSystem({ '/repo/.github/workflows/ci.yml': 'on: push\n' })
      mockedReaddir
        .mockResolvedValueOnce(['workflows'])
        .mockResolvedValueOnce(['..', 'ci.yml'])

      let files = await findYamlFilesRecursive('/repo/.github')

      expect(files).toStrictEqual(['/repo/.github/workflows/ci.yml'])
    })
  })
})
