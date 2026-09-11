import type { PathLike, Stats } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { parseDocument } from 'yaml'

import { scanRecursive } from '../core/scan-recursive'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
}))

vi.mock(import('yaml'), () => ({
  parseDocument: vi.fn(),
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
 * `readdir` narrowed to the overload the scanner calls, which lists entry
 * names.
 */
let mockedReaddir = vi.mocked<(path: PathLike) => Promise<string[]>>(readdir)

/**
 * The part of a parsed YAML document that the scanners read.
 */
interface ScannedDocument {
  contents?: unknown
  toJSON(): unknown
}

/**
 * `parseDocument` narrowed to what the scanners read, so tests can supply
 * hand-built ASTs, including malformed ones.
 */
let mockedParseDocument =
  vi.mocked<(source: string) => ScannedDocument>(parseDocument)

interface MockNode {
  value?: { toJSON?(): unknown; items: MockNode[] } | unknown
  toJSON?(): unknown
  items?: MockNode[]
  key?: MockKey
}

interface MockDocument {
  contents: { items: MockNode[] }
  toJSON(): unknown
}

interface MockKey {
  range: [number, number, number]
  value: string
}

function createMockDocument(data: unknown): MockDocument {
  function createMockNode(
    key: string,
    value: unknown,
    range?: [number, number, number],
  ): MockNode {
    if (Array.isArray(value)) {
      let array = value as unknown[]
      return {
        value: {
          items: array.map((item: unknown, index: number) => {
            if (typeof item === 'object' && item !== null) {
              return {
                items: Object.entries(item as Record<string, unknown>).map(
                  ([entryKey, entryValue]) =>
                    createMockNode(entryKey, entryValue, [
                      index * 20,
                      index * 20 + 1,
                      index * 20 + 1,
                    ]),
                ),
                toJSON: (): unknown => item,
              }
            }
            return { toJSON: (): unknown => item }
          }),
        },
        key: { range: range ?? [0, 1, 1], value: key },
      }
    }
    if (typeof value === 'object' && value !== null) {
      return {
        value: {
          items: Object.entries(value as Record<string, unknown>).map(
            ([entryKey, entryValue]) => createMockNode(entryKey, entryValue),
          ),
          toJSON: () => value,
        },
        key: { range: range ?? [0, 1, 1], value: key },
      }
    }
    return {
      key: { range: range ?? [0, 1, 1], value: key },
      value,
    }
  }

  return {
    contents: {
      items: Object.entries(
        typeof data === 'object' && data !== null ?
          (data as Record<string, unknown>)
        : {},
      ).map(([entryKey, entryValue]) => createMockNode(entryKey, entryValue)),
    },
    toJSON: () => data,
  }
}

describe('scanRecursive', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('works with absolute root and dot directory', async () => {
    mockedLstat.mockRejectedValue(new Error('ENOENT'))

    let result = await scanRecursive('/some/absolute/path', '.')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('scans workflow files recursively', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('.github') || value.endsWith('workflows')) {
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
      if (value.endsWith('.github')) {
        return Promise.resolve(['workflows'])
      }
      if (value.endsWith('workflows')) {
        return Promise.resolve(['ci.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockResolvedValue('workflow content')
    mockedParseDocument.mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
        on: { push: {} },
      }),
    )

    let result = await scanRecursive('.', '.github')

    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(1)
  })

  it('scans composite action files recursively', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('.github') || value.endsWith('actions')) {
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
      if (value.endsWith('.github')) {
        return Promise.resolve(['actions'])
      }
      if (value.endsWith('actions')) {
        return Promise.resolve(['action.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }),
    )

    let result = await scanRecursive('.', '.github')

    expect(result.compositeActions.size).toBe(1)
    expect(result.compositeActions.has('.github/actions')).toBeTruthy()
    expect(result.actions).toHaveLength(1)
  })

  it('uses parent directory name for composite action key', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (
        value.endsWith('project') ||
        value.endsWith('actions') ||
        value.endsWith('build')
      ) {
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
      if (value.endsWith('project')) {
        return Promise.resolve(['actions'])
      }
      if (value.endsWith('actions')) {
        return Promise.resolve(['build'])
      }
      if (value.endsWith('build')) {
        return Promise.resolve(['action.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }),
    )

    let result = await scanRecursive('.', 'project')

    expect(result.compositeActions.has('project/actions/build')).toBeTruthy()
    expect(result.compositeActions.get('project/actions/build')).toContain(
      'action.yml',
    )
  })

  it('uses file path as key for root-level composite action', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('action.yml')) {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => true,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (!value.endsWith('.yml')) {
        return Promise.resolve(['action.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockResolvedValue('action content')
    mockedParseDocument.mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }),
    )

    let result = await scanRecursive('.', '')

    expect(result.compositeActions.size).toBe(1)
    /**
     * Root-level action.yml has '.' as parent, so path is used as key.
     */
    let [key] = result.compositeActions.keys()
    expect(key).toBe('action.yml')
  })

  it('skips files that are neither workflows nor actions', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('dir')) {
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
      if (value.endsWith('dir')) {
        return Promise.resolve(['random.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockResolvedValue('random: content')
    mockedParseDocument.mockReturnValue(
      createMockDocument({
        random: 'content',
      }),
    )

    let result = await scanRecursive('.', 'dir')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('returns empty result when directory does not exist', async () => {
    mockedLstat.mockRejectedValue(new Error('ENOENT'))

    let result = await scanRecursive('.', 'nonexistent')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('skips unreadable files gracefully', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('dir')) {
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
      if (value.endsWith('dir')) {
        return Promise.resolve(['broken.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockRejectedValue(new Error('EACCES'))

    let result = await scanRecursive('.', 'dir')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('scans the current directory when directory is empty string', async () => {
    mockedLstat.mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('ci.yml')) {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => true,
        })
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      })
    })

    mockedReaddir.mockImplementation((path: unknown) => {
      let value = String(path)
      if (!value.endsWith('.yml')) {
        return Promise.resolve(['ci.yml'])
      }
      return Promise.resolve([])
    })

    vi.mocked(readFile).mockResolvedValue('workflow content')
    mockedParseDocument.mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
        on: { push: {} },
      }),
    )

    let result = await scanRecursive('.', '')

    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(1)
  })
})
