import type { Stats } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stat } from 'node:fs/promises'

import { findRepoRoot } from '../../core/fs/find-repo-root'

vi.mock(import('node:fs/promises'), () => ({
  stat: vi.fn(),
}))

describe('findRepoRoot', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  /**
   * Configure the mocked stat to resolve only for the given existing paths.
   *
   * @param existing - Absolute paths that should be reported as existing.
   */
  function mockExisting(existing: string[]): void {
    let set = new Set(existing)
    vi.mocked(stat).mockImplementation((path: unknown) =>
      set.has(String(path)) ?
        Promise.resolve({} as unknown as Stats)
      : Promise.reject(new Error('ENOENT')),
    )
  }

  it('returns the start directory when it contains .git', async () => {
    mockExisting(['/repo/.git'])

    await expect(findRepoRoot('/repo')).resolves.toBe('/repo')
  })

  it('walks up to the nearest ancestor that contains .git', async () => {
    mockExisting(['/repo/.git'])

    await expect(findRepoRoot('/repo/a/b')).resolves.toBe('/repo')
  })

  it('falls back to a .github directory when no .git is found', async () => {
    mockExisting(['/repo/.github'])

    await expect(findRepoRoot('/repo/a')).resolves.toBe('/repo')
  })

  it('prefers the nearest marker', async () => {
    mockExisting(['/repo/a/.git', '/repo/.git'])

    await expect(findRepoRoot('/repo/a/b')).resolves.toBe('/repo/a')
  })

  it('treats a .git file (worktree) as a marker', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) =>
      String(path) === '/repo/.git' ?
        Promise.resolve({ isDirectory: () => false } as unknown as Stats)
      : Promise.reject(new Error('ENOENT')),
    )

    await expect(findRepoRoot('/repo/a')).resolves.toBe('/repo')
  })

  it('returns null when no marker exists up to the filesystem root', async () => {
    mockExisting([])

    await expect(findRepoRoot('/repo/a')).resolves.toBeNull()
  })
})
