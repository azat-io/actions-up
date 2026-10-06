import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

import type { FakeEntry } from '../../helpers/create-fake-file-system'

import { createFakeFileSystem } from '../../helpers/create-fake-file-system'
import { readYamlDocument } from '../../../core/fs/read-yaml-document'

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

/**
 * Text of a small workflow file.
 *
 * @returns Workflow YAML text.
 */
function makeWorkflowText(): string {
  return [
    'on: push',
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
  ].join('\n')
}

describe('readYamlDocument', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns the text of the file and the YAML document parsed from it', async () => {
    let filePath = '/repo/.github/workflows/ci.yml'
    installFileSystem({ [filePath]: makeWorkflowText() })

    let { document, content } = await readYamlDocument(filePath)

    expect(content).toBe(makeWorkflowText())
    expect(document.toJSON()).toStrictEqual({
      jobs: { build: { steps: [{ uses: 'actions/checkout@v4' }] } },
      on: 'push',
    })
  })

  it('rejects when the file cannot be read', async () => {
    installFileSystem({ '/repo/.github/workflows/ci.yml': makeWorkflowText() })

    await expect(
      readYamlDocument('/repo/.github/workflows/missing.yml'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
