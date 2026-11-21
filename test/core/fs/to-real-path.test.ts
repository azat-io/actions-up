import type { PathLike } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { realpath } from 'node:fs/promises'

import { createFakeFileSystem } from '../../helpers/create-fake-file-system'
import { toRealPath } from '../../../core/fs/to-real-path'

vi.mock(import('node:fs/promises'), () => ({ realpath: vi.fn() }))

describe('toRealPath', () => {
  it('follows the symbolic links of a path, and keeps a path it cannot resolve as given', async () => {
    let fileSystem = createFakeFileSystem({
      '/repo/.github/workflows': {
        target: '/repo/config/workflows',
        kind: 'symlink',
      },
      '/repo/config/workflows/ci.yml': 'name: CI\n',
    })
    vi.mocked<(path: PathLike) => Promise<string>>(realpath).mockImplementation(
      fileSystem.realpath,
    )

    await expect(toRealPath('/repo/.github/workflows')).resolves.toBe(
      '/repo/config/workflows',
    )
    await expect(toRealPath('/repo/gone')).resolves.toBe('/repo/gone')
  })
})
