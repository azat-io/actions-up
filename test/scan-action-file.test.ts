import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

import type { FakeEntry } from './helpers/create-fake-file-system'

import { createFakeFileSystem } from './helpers/create-fake-file-system'
import { scanActionFile } from '../core/scan-action-file'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}))

/**
 * Serve `readFile` from an in-memory tree for the running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: Record<string, FakeEntry | string>): void {
  let fileSystem = createFakeFileSystem(entries)
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
}

describe('scanActionFile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reports the actions of a composite action file with their file and line', async () => {
    let filePath = '/repo/.github/actions/setup/action.yml'
    installFileSystem({
      [filePath]: [
        'name: Setup',
        'description: Install the toolchain',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/setup-node@v4',
        '      with:',
        '        node-version: 22',
        '    - run: pnpm install',
        '      shell: bash',
        '',
      ].join('\n'),
    })

    let result = await scanActionFile(filePath)

    expect(result).toStrictEqual([
      {
        uses: 'actions/setup-node@v4',
        ref: 'actions/setup-node@v4',
        name: 'actions/setup-node',
        type: 'external',
        file: filePath,
        version: 'v4',
        line: 6,
      },
    ])
  })

  it('rejects when the action file cannot be read', async () => {
    installFileSystem({
      '/repo/.github/actions/setup/action.yaml': 'name: Setup\n',
    })

    await expect(
      scanActionFile('/repo/.github/actions/setup/action.yml'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  describe('current behavior pending owner decision', () => {
    it('reports the actions the parser recovers from an action file with a syntax error', async () => {
      let filePath = '/repo/.github/actions/setup/action.yml'
      installFileSystem({
        [filePath]: [
          'name: Setup',
          'description: Install the toolchain',
          'runs:',
          '  using: composite',
          '  steps:',
          '    - uses: actions/setup-node@v4',
          '      with: { node-version: 22',
          '    - uses: pnpm/action-setup@v4',
          '',
        ].join('\n'),
      })

      let result = await scanActionFile(filePath)

      expect(result).toStrictEqual([
        {
          uses: 'actions/setup-node@v4',
          ref: 'actions/setup-node@v4',
          name: 'actions/setup-node',
          type: 'external',
          file: filePath,
          version: 'v4',
          line: 6,
        },
        {
          uses: 'pnpm/action-setup@v4',
          ref: 'pnpm/action-setup@v4',
          name: 'pnpm/action-setup',
          type: 'external',
          file: filePath,
          version: 'v4',
          line: 8,
        },
      ])
    })
  })
})
