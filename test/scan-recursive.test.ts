import type { Stats } from 'node:fs'

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
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)
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
    vi.mocked(lstat).mockRejectedValue(new Error('ENOENT'))

    let result = await scanRecursive('/some/absolute/path', '.')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('scans workflow files recursively', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('.github') || value.endsWith('workflows')) {
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
      if (value.endsWith('.github')) {
        return Promise.resolve(['workflows']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (value.endsWith('workflows')) {
        return Promise.resolve(['ci.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
        on: { push: {} },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanRecursive('.', '.github')

    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(1)
  })

  it('scans composite action files recursively', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('.github') || value.endsWith('actions')) {
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
      if (value.endsWith('.github')) {
        return Promise.resolve(['actions']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (value.endsWith('actions')) {
        return Promise.resolve(['action.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('action content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanRecursive('.', '.github')

    expect(result.compositeActions.size).toBe(1)
    expect(result.compositeActions.has('.github/actions')).toBeTruthy()
    expect(result.actions).toHaveLength(1)
  })

  it('uses parent directory name for composite action key', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
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
      if (value.endsWith('project')) {
        return Promise.resolve(['actions']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (value.endsWith('actions')) {
        return Promise.resolve(['build']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (value.endsWith('build')) {
        return Promise.resolve(['action.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('action content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanRecursive('.', 'project')

    expect(result.compositeActions.has('project/actions/build')).toBeTruthy()
    expect(result.compositeActions.get('project/actions/build')).toContain(
      'action.yml',
    )
  })

  it('uses file path as key for root-level composite action', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('action.yml')) {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => true,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (!value.endsWith('.yml')) {
        return Promise.resolve(['action.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('action content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanRecursive('.', '')

    expect(result.compositeActions.size).toBe(1)
    /** Root-level action.yml has '.' as parent, so path is used as key. */
    let [key] = [...result.compositeActions.keys()]
    expect(key).toBe('action.yml')
  })

  it('skips files that are neither workflows nor actions', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('dir')) {
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
      if (value.endsWith('dir')) {
        return Promise.resolve(['random.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('random: content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        random: 'content',
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanRecursive('.', 'dir')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('returns empty result when directory does not exist', async () => {
    vi.mocked(lstat).mockRejectedValue(new Error('ENOENT'))

    let result = await scanRecursive('.', 'nonexistent')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('skips unreadable files gracefully', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('dir')) {
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
      if (value.endsWith('dir')) {
        return Promise.resolve(['broken.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockRejectedValue(new Error('EACCES'))

    let result = await scanRecursive('.', 'dir')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('scans the current directory when directory is empty string', async () => {
    vi.mocked(lstat).mockImplementation((path: unknown) => {
      let value = String(path)
      if (value.endsWith('ci.yml')) {
        return Promise.resolve({
          isSymbolicLink: () => false,
          isDirectory: () => false,
          isFile: () => true,
        } as unknown as Stats)
      }
      return Promise.resolve({
        isSymbolicLink: () => false,
        isDirectory: () => true,
        isFile: () => false,
      } as unknown as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let value = String(path)
      if (!value.endsWith('.yml')) {
        return Promise.resolve(['ci.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
        on: { push: {} },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanRecursive('.', '')

    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(1)
  })
})
