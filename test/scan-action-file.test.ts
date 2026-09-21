import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'

import type { ScannedDocument } from './helpers/create-mock-document'

import { createMockDocument } from './helpers/create-mock-document'
import { scanActionFile } from '../core/scan-action-file'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock(import('yaml'), () => ({
  parseDocument: vi.fn(),
}))

/**
 * `parseDocument` narrowed to what the scanners read, so tests can supply
 * hand-built ASTs, including malformed ones.
 */
let mockedParseDocument =
  vi.mocked<(source: string) => ScannedDocument>(parseDocument)

describe('scanActionFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scans composite action file with steps', async () => {
    let mockAction = {
      runs: {
        steps: [
          { uses: 'actions/checkout@v4' },
          { run: 'echo "Running action"', shell: 'bash' },
          { uses: 'actions/cache@v3' },
        ],
        using: 'composite',
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile('.github/actions/build/action.yml')

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
    })
    expect(result[1]).toMatchObject({
      name: 'actions/cache',
      type: 'external',
      version: 'v3',
    })
  })

  it('handles action without runs field', async () => {
    let mockAction = {
      description: 'Action without runs',
      name: 'My Action',
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile('.github/actions/empty/action.yml')

    expect(result).toEqual([])
  })

  it('handles action with empty steps', async () => {
    let mockAction = {
      runs: {
        using: 'composite',
        steps: [],
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile('.github/actions/no-steps/action.yml')

    expect(result).toEqual([])
  })

  it('handles action without steps field', async () => {
    let mockAction = {
      runs: {
        image: 'Dockerfile',
        using: 'docker',
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile('.github/actions/docker/action.yml')

    expect(result).toEqual([])
  })

  it('handles non-composite action', async () => {
    let mockAction = {
      runs: {
        main: 'index.js',
        using: 'node20',
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile('.github/actions/node/action.yml')

    expect(result).toEqual([])
  })

  it('throws error for invalid YAML', async () => {
    vi.mocked(readFile).mockResolvedValue('invalid: yaml: content')
    mockedParseDocument.mockImplementation(() => {
      throw new Error('Invalid YAML')
    })

    await expect(
      scanActionFile('.github/actions/invalid/action.yml'),
    ).rejects.toThrow('Invalid YAML')
  })

  it('throws error when file read fails', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('File not found'))

    await expect(
      scanActionFile('.github/actions/missing/action.yml'),
    ).rejects.toThrow('File not found')
  })

  it('returns empty array for null action content', async () => {
    vi.mocked(readFile).mockResolvedValue('')
    mockedParseDocument.mockReturnValue(createMockDocument(null))

    let result = await scanActionFile('.github/actions/null/action.yml')

    expect(result).toEqual([])
  })

  it('returns empty array when steps node is not a YAML sequence', async () => {
    let mockAction = {
      runs: {
        steps: 'not-an-array',
        using: 'composite',
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile('.github/actions/invalid/action.yml')
    expect(result).toEqual([])
  })

  it('returns empty when JSON has steps array but AST steps is not a YAMLSeq', async () => {
    let manualDocument = {
      contents: {
        items: [
          {
            value: {
              items: [
                {
                  key: { value: 'steps' },
                  value: 'wrong-type',
                },
              ],
            },
            key: { value: 'runs' },
          },
        ],
      },
      toJSON: () => ({
        runs: { steps: [{ uses: 'actions/checkout@v4' }], using: 'composite' },
      }),
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(manualDocument)

    let result = await scanActionFile('.github/actions/ast-not-seq/action.yml')
    expect(result).toEqual([])
  })

  it('ignores step entries where uses is non-string (e.g., number)', async () => {
    let mockAction = {
      runs: {
        steps: [{ uses: 42 }],
        using: 'composite',
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile(
      '.github/actions/non-string-uses/action.yml',
    )
    expect(result).toEqual([])
  })

  it('skips non-map step nodes (primitive entries in steps array)', async () => {
    let mockAction = {
      runs: {
        steps: ['echo hello', { uses: 'actions/checkout@v4' }],
        using: 'composite',
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(createMockDocument(mockAction))

    let result = await scanActionFile(
      '.github/actions/primitive-step/action.yml',
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'actions/checkout' })
  })

  it('skips step node that is a YAML map without toJSON (not a Node)', async () => {
    let manualDocument = {
      contents: {
        items: [
          {
            value: {
              items: [
                {
                  value: {
                    items: [
                      {
                        items: [
                          {
                            value: 'actions/checkout@v4',
                            key: { value: 'uses' },
                          },
                        ],
                      },
                    ],
                  },
                  key: { value: 'steps' },
                },
              ],
            },
            key: { value: 'runs' },
          },
        ],
      },
      toJSON: () => ({
        runs: { steps: [{ uses: 'actions/checkout@v4' }], using: 'composite' },
      }),
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(manualDocument)

    let result = await scanActionFile(
      '.github/actions/map-without-node/action.yml',
    )
    expect(result).toEqual([])
  })

  it('returns empty when runs pair is not a YAML map (mismatch between AST and JSON)', async () => {
    let manualDocument = {
      toJSON: () => ({
        runs: { steps: [{ uses: 'actions/checkout@v4' }], using: 'composite' },
      }),
      contents: {
        items: [{ key: { value: 'runs' }, value: 'composite' }],
      },
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(manualDocument)

    let result = await scanActionFile('.github/actions/runs-not-map/action.yml')
    expect(result).toEqual([])
  })

  it('returns empty when document contents is missing', async () => {
    let manualDocument = {
      toJSON: () => ({
        runs: { steps: [{ uses: 'actions/checkout@v4' }], using: 'composite' },
      }),
    }

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(manualDocument)

    let result = await scanActionFile('.github/actions/no-contents/action.yml')
    expect(result).toEqual([])
  })
})
