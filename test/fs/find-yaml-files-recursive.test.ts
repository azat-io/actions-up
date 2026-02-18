import type { Stats } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdir, lstat } from 'node:fs/promises'

import { findYamlFilesRecursive } from '../../core/fs/find-yaml-files-recursive'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
}))

describe('findYamlFilesRecursive', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('finds YAML files recursively', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root' || value === '/root/sub') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve([
          'ci.yml',
          'sub',
          'readme.md',
        ]) as unknown as ReturnType<typeof readdir>
      }
      if (value === '/root/sub') {
        return Promise.resolve([
          'deploy.yaml',
          'script.sh',
        ]) as unknown as ReturnType<typeof readdir>
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(2)
    expect(files).toContain('/root/ci.yml')
    expect(files).toContain('/root/sub/deploy.yaml')
  })

  it('skips symlinks', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      if (value === '/root/link-dir') {
        return Promise.resolve({
          isSymbolicLink: () => true,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      if (value === '/root/link-file.yml') {
        return Promise.resolve({
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => true,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve([
          'real.yml',
          'link-dir',
          'link-file.yml',
        ]) as unknown as ReturnType<typeof readdir>
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(1)
    expect(files).toContain('/root/real.yml')
  })

  it('returns empty array for empty directory', async () => {
    vi.mocked(lstat).mockResolvedValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
    } as unknown as Stats)

    vi.mocked(readdir).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof readdir>>,
    )

    let files = await findYamlFilesRecursive('/empty')

    expect(files).toHaveLength(0)
  })

  it('skips non-YAML files', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockResolvedValue([
      'readme.md',
      'script.sh',
      'config.json',
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(0)
  })

  it('prevents visiting the same directory twice', async () => {
    let visitCount = 0

    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root' || value === '/root/sub') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        visitCount++
        return Promise.resolve(['test.yml', 'sub']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (value === '/root/sub') {
        return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    await findYamlFilesRecursive('/root')

    expect(visitCount).toBe(1)
  })

  it('skips already visited directory via path normalization', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root' || value === '/root/sub') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve(['sub']) as unknown as ReturnType<typeof readdir>
      }
      if (value === '/root/sub') {
        /**
         * '..' normalizes to '/root' which is already visited.
         */
        return Promise.resolve(['..', 'test.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(1)
    expect(files).toContain('/root/sub/test.yml')
  })

  it('continues scanning when individual entries fail', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          isFile: () => false,
        } as unknown as Stats)
      }
      if (value === '/root/forbidden') {
        return Promise.reject(new Error('EACCES'))
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value === '/root') {
        return Promise.resolve([
          'good.yml',
          'forbidden',
          'also-good.yaml',
        ]) as unknown as ReturnType<typeof readdir>
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let files = await findYamlFilesRecursive('/root')

    expect(files).toHaveLength(2)
    expect(files).toContain('/root/good.yml')
    expect(files).toContain('/root/also-good.yaml')
  })

  it('skips root directory if it is a symlink', async () => {
    vi.mocked(lstat).mockResolvedValue({
      isSymbolicLink: () => true,
      isDirectory: () => true,
      isFile: () => false,
    } as unknown as Stats)

    let files = await findYamlFilesRecursive('/symlink-root')

    expect(files).toHaveLength(0)
  })
})
