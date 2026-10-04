import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

import type { FakeEntry } from './helpers/create-fake-file-system'

import { createFakeFileSystem } from './helpers/create-fake-file-system'
import { scanWorkflowFile } from '../core/scan-workflow-file'

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

describe('scanWorkflowFile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reports the actions of a workflow file with their file, job and line', async () => {
    let filePath = '/repo/.github/workflows/ci.yml'
    installFileSystem({
      [filePath]: [
        'name: CI',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - run: pnpm test',
        '',
      ].join('\n'),
    })

    let result = await scanWorkflowFile(filePath)

    expect(result).toStrictEqual([
      {
        uses: 'actions/checkout@v4',
        ref: 'actions/checkout@v4',
        name: 'actions/checkout',
        type: 'external',
        file: filePath,
        version: 'v4',
        job: 'build',
        line: 7,
      },
    ])
  })

  it('rejects when the workflow file cannot be read', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': 'on: push\n',
    })

    await expect(
      scanWorkflowFile('/repo/.github/workflows/missing.yml'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  describe('current behavior pending owner decision', () => {
    it('reports the actions the parser recovers from a workflow with a syntax error', async () => {
      let filePath = '/repo/.github/workflows/ci.yml'
      installFileSystem({
        [filePath]: [
          'on: push',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '      - uses: actions/setup-node@v4',
          '        with: { node-version: 22',
          '',
        ].join('\n'),
      })

      let result = await scanWorkflowFile(filePath)

      expect(result).toStrictEqual([
        {
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v4',
          job: 'build',
          line: 6,
        },
        {
          uses: 'actions/setup-node@v4',
          ref: 'actions/setup-node@v4',
          name: 'actions/setup-node',
          type: 'external',
          file: filePath,
          version: 'v4',
          job: 'build',
          line: 7,
        },
      ])
    })
  })
})
