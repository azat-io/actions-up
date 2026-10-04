// CSpell:ignore gitdir worktrees
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stat } from 'node:fs/promises'

import type { FakeEntry } from '../helpers/create-fake-file-system'

import { createFakeFileSystem } from '../helpers/create-fake-file-system'
import { findRepoRoot } from '../../core/fs/find-repo-root'

vi.mock(import('node:fs/promises'), () => ({
  stat: vi.fn(),
}))

/**
 * Serve `stat` from an in-memory tree for the running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: Record<string, FakeEntry | string>): void {
  let fileSystem = createFakeFileSystem(entries)
  vi.mocked(stat).mockImplementation(fileSystem.stat)
}

describe('findRepoRoot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns the start directory when it contains .git', async () => {
    installFileSystem({
      '/repo/.git/HEAD': 'ref: refs/heads/main\n',
      '/repo/package.json': '{}\n',
    })

    let root = await findRepoRoot('/repo')

    expect(root).toBe('/repo')
  })

  it('walks up to the nearest ancestor that contains .git', async () => {
    installFileSystem({
      '/repo/.git/HEAD': 'ref: refs/heads/main\n',
      '/repo/src/cli/index.ts': 'export {}\n',
    })

    let root = await findRepoRoot('/repo/src/cli')

    expect(root).toBe('/repo')
  })

  it('falls back to a .github directory when no .git is found', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': 'on: push\n',
      '/repo/src/index.ts': 'export {}\n',
    })

    let root = await findRepoRoot('/repo/src')

    expect(root).toBe('/repo')
  })

  it('prefers the nearest marker', async () => {
    installFileSystem({
      '/repo/packages/app/.git/HEAD': 'ref: refs/heads/main\n',
      '/repo/packages/app/src/index.ts': 'export {}\n',
      '/repo/.git/HEAD': 'ref: refs/heads/main\n',
    })

    let root = await findRepoRoot('/repo/packages/app/src')

    expect(root).toBe('/repo/packages/app')
  })

  it('treats a .git file (worktree) as a marker', async () => {
    installFileSystem({
      '/repo/.git': 'gitdir: /home/dev/main/.git/worktrees/repo\n',
      '/repo/src/index.ts': 'export {}\n',
    })

    let root = await findRepoRoot('/repo/src')

    expect(root).toBe('/repo')
  })

  it('returns null when no marker exists up to the filesystem root', async () => {
    installFileSystem({
      '/home/dev/notes/todo.md': '# Todo\n',
    })

    let root = await findRepoRoot('/home/dev/notes')

    expect(root).toBeNull()
  })
})
