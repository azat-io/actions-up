import type { PathLike, Stats } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdir, lstat } from 'node:fs/promises'

import { findYamlFilesRecursive } from '../../core/fs/find-yaml-files-recursive'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
}))

/**
 * The part of `fs.Stats` that the walker reads.
 */
type EntryStats = Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'isFile'>

/**
 * `lstat` narrowed to the fields the walker reads.
 */
let mockedLstat = vi.mocked<(path: PathLike) => Promise<EntryStats>>(lstat)

/**
 * `readdir` narrowed to the overload the walker calls, which lists entry names.
 */
let mockedReaddir = vi.mocked<(path: PathLike) => Promise<string[]>>(readdir)

describe('findYamlFilesRecursive', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('finds YAML files recursively', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root' || value === '/root/sub') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve(['ci.yml', 'sub', 'readme.md'])
      }
      if (value === '/root/sub') {
        return Promise.resolve(['deploy.yaml', 'script.sh'])
      }
      return Promise.resolve([])
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(2)
    expect(files).toContain('/root/ci.yml')
    expect(files).toContain('/root/sub/deploy.yaml')
  })

  it('skips symlinks', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      if (value === '/root/link-dir') {
        return Promise.resolve({
          isSymbolicLink: () => true,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      if (value === '/root/link-file.yml') {
        return Promise.resolve({
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => true,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve(['real.yml', 'link-dir', 'link-file.yml'])
      }
      return Promise.resolve([])
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(1)
    expect(files).toContain('/root/real.yml')
  })

  it('returns empty array for empty directory', async () => {
    mockedLstat.mockResolvedValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
    })

    mockedReaddir.mockResolvedValue([])

    let files = await findYamlFilesRecursive('/empty')

    expect(files).toHaveLength(0)
  })

  it('skips non-YAML files', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      })
    })

    mockedReaddir.mockResolvedValue(['readme.md', 'script.sh', 'config.json'])

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(0)
  })

  it('prevents visiting the same directory twice', async () => {
    let visitCount = 0

    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root' || value === '/root/sub') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        visitCount++
        return Promise.resolve(['test.yml', 'sub'])
      }
      if (value === '/root/sub') {
        return Promise.resolve([])
      }
      return Promise.resolve([])
    })

    await findYamlFilesRecursive('/root')

    expect(visitCount).toBe(1)
  })

  it('skips already visited directory via path normalization', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root' || value === '/root/sub') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve(['sub'])
      }
      if (value === '/root/sub') {
        /**
         * '..' normalizes to '/root' which is already visited.
         */
        return Promise.resolve(['..', 'test.yml'])
      }
      return Promise.resolve([])
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(1)
    expect(files).toContain('/root/sub/test.yml')
  })

  it('continues scanning when individual entries fail', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        })
      }
      if (value === '/root/forbidden') {
        return Promise.reject(new Error('EACCES'))
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve(['good.yml', 'forbidden', 'also-good.yaml'])
      }
      return Promise.resolve([])
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(2)
    expect(files).toContain('/root/good.yml')
    expect(files).toContain('/root/also-good.yaml')
  })

  it('skips root directory if it is a symlink', async () => {
    mockedLstat.mockResolvedValue({
      isSymbolicLink: () => true,
      isDirectory: () => true,
      isFile: () => false,
    })

    let files = await findYamlFilesRecursive('/symlink-root')

    expect(files).toHaveLength(0)
  })
})
