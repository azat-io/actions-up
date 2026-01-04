import type { Stats } from 'node:fs'

import { beforeEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, stat } from 'node:fs/promises'
import { parseDocument } from 'yaml'

import type { GitHubAction } from '../types/github-action'

import { scanGitHubActions } from '../core/scan-github-actions'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
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

interface WorkflowModule {
  scanWorkflowFile(filePath: string): Promise<GitHubAction[]>
}

interface ActionModule {
  scanActionFile(filePath: string): Promise<GitHubAction[]>
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

let workflowModule: WorkflowModule | undefined
let actionModule: ActionModule | undefined

describe('scanGitHubActions', () => {
  beforeAll(async () => {
    workflowModule = await import('../core/scan-workflow-file')
    actionModule = await import('../core/scan-action-file')
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('throws when ci directory traverses outside root', async () => {
    await expect(scanGitHubActions('.', '../outside')).rejects.toThrowError(
      'Invalid path',
    )
  })

  it('scans workflows and composite actions successfully', async () => {
    let mockWorkflow = {
      jobs: {
        build: {
          steps: [
            { uses: 'actions/checkout@v4' },
            { uses: './.github/actions/build' },
          ],
        },
      },
    }

    let mockAction = {
      runs: {
        steps: [{ uses: 'actions/setup-node@v5' }],
        using: 'composite',
      },
    }

    vi.mocked(stat).mockImplementation(
      (path: Parameters<typeof stat>[0]): ReturnType<typeof stat> =>
        Promise.resolve({
          isDirectory: () => {
            let pathValue = String(path)
            return (
              pathValue.includes('workflows') || pathValue.includes('actions')
            )
          },
        } as Stats) as ReturnType<typeof stat>,
    )

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve([
            'ci.yml',
            'release.yml',
          ]) as unknown as ReturnType<typeof readdir>
        }
        return Promise.resolve(['build']) as unknown as ReturnType<
          typeof readdir
        >
      },
    )

    vi.mocked(readFile).mockImplementation(
      (path: Parameters<typeof readFile>[0]): ReturnType<typeof readFile> => {
        let pathValue = JSON.stringify(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve('workflow content') as ReturnType<
            typeof readFile
          >
        }
        if (pathValue.includes('action.yml')) {
          return Promise.resolve('action content') as ReturnType<
            typeof readFile
          >
        }
        return Promise.resolve('') as ReturnType<typeof readFile>
      },
    )

    vi.mocked(parseDocument).mockImplementation((content: string) => {
      if (content === 'workflow content') {
        return createMockDocument(mockWorkflow) as unknown as ReturnType<
          typeof parseDocument
        >
      }
      if (content === 'action content') {
        return createMockDocument(mockAction) as unknown as ReturnType<
          typeof parseDocument
        >
      }
      return createMockDocument(null) as unknown as ReturnType<
        typeof parseDocument
      >
    })

    let result = await scanGitHubActions('.')

    expect(result.actions).toHaveLength(5)
    expect(result.workflows.size).toBe(2)
    expect(result.compositeActions.size).toBe(1)
    expect(result.compositeActions.get('build')).toBe('.github/actions/build')
  })

  it('skips invalid workflow names and logs warning', async () => {
    let warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.mocked(stat).mockImplementation(pathArgument => {
      let pathValue = String(pathArgument)
      if (pathValue.endsWith('.github/workflows')) {
        return Promise.resolve({
          isDirectory: () => true,
        } as Stats)
      }
      if (pathValue.endsWith('.github/actions')) {
        return Promise.resolve({
          isDirectory: () => false,
        } as Stats)
      }
      return Promise.reject(new Error('ENOENT'))
    })

    vi.mocked(readdir).mockImplementation(pathArgument => {
      let pathValue = String(pathArgument)
      if (pathValue.endsWith('.github/workflows')) {
        return Promise.resolve(['..evil.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let result = await scanGitHubActions('.')

    expect(result.workflows.size).toBe(0)
    expect(
      warnSpy.mock.calls.some(
        ([message]) =>
          typeof message === 'string' &&
          message.includes('Skipping invalid name'),
      ),
    ).toBeTruthy()

    warnSpy.mockRestore()
  })

  it('handles missing .github directory', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

    let result = await scanGitHubActions('.')

    expect(result.actions).toEqual([])
    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
  })

  it('handles missing workflows directory', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.includes('workflows')) {
        return Promise.reject(new Error('ENOENT'))
      }
      return Promise.resolve({
        isDirectory: () => typeof path === 'string' && path.includes('actions'),
      } as Stats)
    })

    vi.mocked(readdir).mockImplementation(path => {
      if (
        typeof path === 'string' &&
        path.includes('actions') &&
        !path.includes('test')
      ) {
        return Promise.resolve(['test']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (typeof path === 'string' && path.includes('test')) {
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
          steps: [{ uses: 'actions/cache@v3' }],
          using: 'composite',
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(1)
    expect(result.actions).toHaveLength(1)
  })

  it('handles missing actions directory', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) => {
      if (
        typeof path === 'string' &&
        path.includes('actions') &&
        !path.includes('workflows')
      ) {
        return Promise.reject(new Error('ENOENT'))
      }
      return Promise.resolve({
        isDirectory: () =>
          typeof path === 'string' && path.includes('workflows'),
      } as Stats)
    })

    vi.mocked(readdir).mockImplementation(
      () =>
        Promise.resolve(['test.yml']) as unknown as ReturnType<typeof readdir>,
    )

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          test: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.workflows.size).toBe(1)
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(1)
  })

  it('returns empty result when repository slug cannot be detected', async () => {
    let previous = process.env['GITHUB_REPOSITORY']
    delete process.env['GITHUB_REPOSITORY']

    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as Stats)
    vi.mocked(readdir).mockResolvedValue([])
    vi.mocked(readFile).mockRejectedValue(new Error('no config'))

    let result = await scanGitHubActions('.')

    expect(result.actions).toHaveLength(0)
    process.env['GITHUB_REPOSITORY'] = previous
  })

  it('handles empty workflows directory', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats)

    vi.mocked(readdir).mockResolvedValue([])

    let result = await scanGitHubActions('.')

    expect(result.actions).toEqual([])
    expect(result.workflows.size).toBe(0)
    expect(result.compositeActions.size).toBe(0)
  })

  it('adds workflows with no actions to the result', async () => {
    vi.mocked(stat).mockResolvedValue({
      isDirectory: () => true,
    } as Stats)

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve(['empty.yml']) as unknown as ReturnType<
            typeof readdir
          >
        }
        return Promise.resolve([]) as ReturnType<typeof readdir>
      },
    )

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [{ run: 'echo "Hello"' }],
          },
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.workflows.size).toBe(1)
    expect(result.workflows.has('.github/workflows/empty.yml')).toBeTruthy()
    expect(result.workflows.get('.github/workflows/empty.yml')).toEqual([])
    expect(result.actions).toHaveLength(0)
  })

  it('ignores non-YAML files in workflows directory', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) =>
      Promise.resolve({
        isDirectory: () =>
          typeof path === 'string' &&
          (path.includes('workflows') || path.includes('actions')),
      } as Stats),
    )

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve([
            'ci.yml',
            'readme.md',
            'script.sh',
          ]) as unknown as ReturnType<typeof readdir>
        }
        return Promise.resolve([]) as ReturnType<typeof readdir>
      },
    )

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.workflows.size).toBe(1)
    expect(result.workflows.has('.github/workflows/ci.yml')).toBeTruthy()
  })

  it('handles workflow scan errors gracefully', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats)

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve([
            'valid.yml',
            'invalid.yml',
          ]) as unknown as ReturnType<typeof readdir>
        }
        return Promise.resolve([]) as ReturnType<typeof readdir>
      },
    )

    vi.mocked(readFile).mockImplementation(path => {
      if (typeof path === 'string' && path.includes('invalid')) {
        return Promise.reject(new Error('Read error'))
      }
      return Promise.resolve('workflow content')
    })

    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          test: {
            steps: [{ uses: 'actions/setup-go@v4' }],
          },
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(1)
  })

  it('scans composite actions with action.yaml files', async () => {
    vi.mocked(stat).mockImplementation(
      (path: Parameters<typeof stat>[0]): ReturnType<typeof stat> =>
        Promise.resolve({
          isDirectory: () => {
            let pathValue = String(path)
            return pathValue.includes('.github')
          },
        } as Stats) as ReturnType<typeof stat>,
    )

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('actions') && !pathValue.includes('setup')) {
          return Promise.resolve(['setup']) as unknown as ReturnType<
            typeof readdir
          >
        }
        return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
      },
    )

    vi.mocked(readFile).mockImplementation(
      (path: Parameters<typeof readFile>[0]): ReturnType<typeof readFile> => {
        let pathValue = JSON.stringify(path)
        if (pathValue.includes('action.yml')) {
          return Promise.reject(new Error('File not found'))
        }
        return Promise.resolve('action content') as ReturnType<typeof readFile>
      },
    )

    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.compositeActions.size).toBe(1)
    expect(result.compositeActions.has('setup')).toBeTruthy()
    expect(result.actions).toHaveLength(1)
    let firstAction = result.actions[0]!
    expect(firstAction.name).toBe('actions/setup-node')
  })

  it('applies queue guards when following same-repo composite actions', async () => {
    let actionsList: GitHubAction[] = [
      {
        name: './.github/actions/local-build',
        file: '.github/workflows/ci.yml',
        type: 'local',
        version: 'v1',
      },
      {
        file: '.github/workflows/ci.yml',
        name: 'owner/repo',
        type: 'external',
        version: 'v1',
      },
      {
        file: '.github/workflows/ci.yml',
        name: 'other/repo/composite',
        type: 'external',
        version: 'v1',
      },
      {
        name: 'owner/repo/../outside/composite',
        file: '.github/workflows/ci.yml',
        type: 'external',
        version: 'v1',
      },
      {
        name: 'owner/repo/composite/path',
        file: '.github/workflows/ci.yml',
        type: 'external',
        version: 'v1',
      },
      {
        name: 'owner/repo/composite/path',
        file: '.github/workflows/ci.yml',
        type: 'external',
        version: 'v1',
      },
    ]

    let workflowSpy = vi
      .spyOn(workflowModule!, 'scanWorkflowFile')
      .mockResolvedValue(actionsList)

    let actionSpy = vi
      .spyOn(actionModule!, 'scanActionFile')
      .mockResolvedValue([
        {
          file: '.github/actions/internal/action.yml',
          name: './.github/actions/internal',
          type: 'local',
          version: 'v1',
        },
        {
          file: '.github/actions/composite/path/action.yml',
          name: 'owner/repo',
          type: 'external',
          version: 'v1',
        },
        {
          file: '.github/actions/composite/path/action.yml',
          name: 'other/repo/path',
          type: 'external',
          version: 'v1',
        },
        {
          file: '.github/actions/composite/path/action.yml',
          name: 'owner/repo/../escape/path',
          type: 'external',
          version: 'v1',
        },
        {
          file: '.github/actions/composite/path/action.yml',
          name: 'owner/repo/composite/path',
          type: 'external',
          version: 'v1',
        },
        {
          file: '.github/actions/composite/path/action.yml',
          name: 'owner/repo/composite/path',
          type: 'external',
          version: 'v1',
        },
        {
          file: '.github/actions/composite/invalid/action.yml',
          name: 'owner/repo/composite/invalid',
          type: 'external',
          version: 'v1',
        },
      ])

    vi.mocked(stat).mockImplementation(pathArgument => {
      let value = String(pathArgument)
      if (value.endsWith('.github/workflows')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      if (value.endsWith('.github/actions')) {
        return Promise.resolve({ isDirectory: () => false } as Stats)
      }
      if (value.endsWith('composite/path/action.yml')) {
        return Promise.resolve({ isFile: () => false } as Stats)
      }
      if (value.endsWith('composite/path/action.yaml')) {
        return Promise.resolve({ isFile: () => true } as Stats)
      }
      if (value.endsWith('composite/invalid/action.yml')) {
        return Promise.resolve({ isFile: () => false } as Stats)
      }
      if (value.endsWith('composite/invalid/action.yaml')) {
        return Promise.resolve({ isFile: () => false } as Stats)
      }
      if (value.endsWith('deeper/component/action.yml')) {
        return Promise.resolve({ isFile: () => false } as Stats)
      }
      return Promise.reject(new Error('ENOENT'))
    })

    vi.mocked(readdir).mockImplementation(pathArgument => {
      let value = String(pathArgument)
      if (value.endsWith('.github/workflows')) {
        return Promise.resolve(['ci.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let previousRepo = process.env['GITHUB_REPOSITORY']
    process.env['GITHUB_REPOSITORY'] = 'owner/repo'

    let result = await scanGitHubActions('.')

    expect(result.actions.length).toBeGreaterThanOrEqual(2)

    process.env['GITHUB_REPOSITORY'] = previousRepo
    workflowSpy.mockRestore()
    actionSpy.mockRestore()
  })

  it('handles composite action scan errors gracefully', async () => {
    vi.mocked(stat).mockImplementation(
      (path: Parameters<typeof stat>[0]): ReturnType<typeof stat> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.reject(new Error('ENOENT'))
        }
        return Promise.resolve({
          isDirectory: () => pathValue.includes('actions'),
        } as Stats) as ReturnType<typeof stat>
      },
    )

    vi.mocked(readdir).mockImplementation(
      (): ReturnType<typeof readdir> =>
        Promise.resolve(['valid', 'invalid']) as unknown as ReturnType<
          typeof readdir
        >,
    )

    vi.mocked(readFile).mockImplementation(
      (path: Parameters<typeof readFile>[0]): ReturnType<typeof readFile> => {
        let pathValue = JSON.stringify(path)
        if (pathValue.includes('invalid')) {
          return Promise.reject(new Error('Read error'))
        }
        return Promise.resolve('action content') as ReturnType<typeof readFile>
      },
    )

    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/cache@v3' }],
          using: 'composite',
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    expect(result.compositeActions.size).toBe(1)
    expect(result.compositeActions.has('valid')).toBeTruthy()
    expect(result.actions).toHaveLength(1)
  })

  it('skips subdirectory when stat(subdirPath) throws', async () => {
    vi.mocked(stat).mockImplementation(
      (path: Parameters<typeof stat>[0]): ReturnType<typeof stat> => {
        let pathValue = String(path)

        if (pathValue.endsWith('workflows')) {
          return Promise.resolve({ isDirectory: () => true } as Stats)
        }
        if (pathValue.endsWith('actions')) {
          return Promise.resolve({ isDirectory: () => true } as Stats)
        }
        if (pathValue.includes('/actions/bad')) {
          return Promise.reject(new Error('stat error'))
        }
        return Promise.resolve({ isDirectory: () => false } as Stats)
      },
    )

    vi.mocked(readdir).mockImplementation(
      (): ReturnType<typeof readdir> =>
        Promise.resolve(['bad']) as unknown as ReturnType<typeof readdir>,
    )

    let result = await scanGitHubActions('.')
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('skips invalid action subdirectory names', async () => {
    let warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    vi.mocked(stat).mockImplementation(pathArgument => {
      let value = String(pathArgument)
      if (value.endsWith('.github/workflows')) {
        return Promise.resolve({ isDirectory: () => false } as Stats)
      }
      if (value.endsWith('.github/actions')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      return Promise.resolve({ isDirectory: () => false } as Stats)
    })

    vi.mocked(readdir).mockImplementation(pathArgument => {
      let value = String(pathArgument)
      if (value.endsWith('.github/actions')) {
        return Promise.resolve(['..bad']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    let result = await scanGitHubActions('.')

    expect(result.compositeActions.size).toBe(0)
    warnSpy.mockRestore()
  })

  it('follows same-repo external composite actions referenced by owner/repo/path@ref', async () => {
    process.env['GITHUB_REPOSITORY'] = 'my/repo'

    vi.mocked(stat).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.github/workflows')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      if (currentPath.endsWith('setup-js/action.yml')) {
        return Promise.resolve({
          isDirectory: () => false,
          isFile: () => true,
        } as unknown as Stats)
      }
      if (currentPath.endsWith('.github/actions')) {
        return Promise.resolve({ isDirectory: () => false } as Stats)
      }
      return Promise.reject(new Error('ENOENT'))
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.github/workflows')) {
        return Promise.resolve(['coverage.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('coverage.yml')) {
        return Promise.resolve('workflow content') as unknown as ReturnType<
          typeof readFile
        >
      }
      if (currentPath.endsWith('setup-js/action.yml')) {
        return Promise.resolve('action content') as unknown as ReturnType<
          typeof readFile
        >
      }
      return Promise.reject(new Error('not used'))
    })

    vi.mocked(parseDocument).mockImplementation((content: string) => {
      if (content === 'workflow content') {
        return createMockDocument({
          jobs: {
            coverage: {
              steps: [{ uses: 'my/repo/setup-js@v1' }],
            },
          },
        }) as unknown as ReturnType<typeof parseDocument>
      }
      if (content === 'action content') {
        return createMockDocument({
          runs: {
            steps: [{ uses: 'actions/setup-node@v5' }],
            using: 'composite',
          },
        }) as unknown as ReturnType<typeof parseDocument>
      }
      return createMockDocument(null) as unknown as ReturnType<
        typeof parseDocument
      >
    })

    let result = await scanGitHubActions('.')
    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(2)
    expect(
      result.actions.some(
        a => a.type === 'external' && a.name === 'actions/setup-node',
      ),
    ).toBeTruthy()

    delete process.env['GITHUB_REPOSITORY']
  })

  it('parses repo slug from .git/config when env is absent', async () => {
    delete process.env['GITHUB_REPOSITORY']

    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

    vi.mocked(readFile).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.git/config')) {
        return Promise.resolve(
          '[remote "origin"]\n' +
            '    url = https://github.com/acme/demo.git\n' +
            '    fetch = +refs/heads/*:refs/remotes/origin/*\n',
        ) as unknown as ReturnType<typeof readFile>
      }
      return Promise.reject(new Error('not used'))
    })

    let result = await scanGitHubActions('.')
    expect(result.actions).toEqual([])

    delete process.env['GITHUB_REPOSITORY']
  })

  it('falls back to any remote url when origin is absent', async () => {
    delete process.env['GITHUB_REPOSITORY']

    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

    vi.mocked(readFile).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.git/config')) {
        return Promise.resolve(
          '[remote "upstream"]\n' +
            '    url = git@github.com:acme/up.git\n' +
            '    fetch = +refs/heads/*:refs/remotes/upstream/*\n',
        ) as unknown as ReturnType<typeof readFile>
      }
      return Promise.reject(new Error('not used'))
    })

    let result = await scanGitHubActions('.')
    expect(result.actions).toEqual([])

    delete process.env['GITHUB_REPOSITORY']
  })

  it('ignores repo detection errors (outer catch covered)', async () => {
    process.env['ACTIONS_UP_TEST_THROW'] = '1'

    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as Stats)
    vi.mocked(readdir).mockResolvedValue([])

    let result = await scanGitHubActions('.')
    expect(result.actions).toEqual([])

    delete process.env['ACTIONS_UP_TEST_THROW']
  })

  it.each([
    ['project', 'custom project directory'],
    ['../parent', 'parent directory'],
    ['/absolute/path', 'absolute path'],
  ])('scans from %s (%s)', async rootPath => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats)

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve(['test.yml']) as unknown as ReturnType<
            typeof readdir
          >
        }
        return Promise.resolve([]) as ReturnType<typeof readdir>
      },
    )

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          test: {
            steps: [{ uses: 'actions/checkout@v4' }],
          },
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions(rootPath)

    expect(result.actions).toHaveLength(1)
    expect(result.workflows.size).toBe(1)
  })

  it('deduplicates actions across workflows', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats)

    vi.mocked(readdir).mockImplementation(
      (path: Parameters<typeof readdir>[0]): ReturnType<typeof readdir> => {
        let pathValue = String(path)
        if (pathValue.includes('workflows')) {
          return Promise.resolve([
            'ci.yml',
            'test.yml',
          ]) as unknown as ReturnType<typeof readdir>
        }
        return Promise.resolve([]) as ReturnType<typeof readdir>
      },
    )

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        jobs: {
          build: {
            steps: [
              { uses: 'actions/checkout@v4' },
              { uses: 'actions/checkout@v4' },
            ],
          },
        },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.')

    let checkoutActions = result.actions.filter(
      (action: GitHubAction) =>
        action.name === 'actions/checkout' && action.version === 'v4',
    )
    expect(checkoutActions).toHaveLength(4)
    expect(result.workflows.size).toBe(2)
  })

  it('handles workflows path that is not a directory', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.endsWith('workflows')) {
        return Promise.resolve({ isDirectory: () => false } as Stats)
      }
      return Promise.resolve({ isDirectory: () => true } as Stats)
    })

    vi.mocked(readdir).mockResolvedValue([])

    let result = await scanGitHubActions('.')
    expect(result.workflows.size).toBe(0)
    expect(result.actions).toEqual([])
  })

  it('skips non-directory entries under .github/actions', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.endsWith('workflows')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      if (typeof path === 'string' && path.endsWith('actions')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      return Promise.resolve({ isDirectory: () => false } as Stats)
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.endsWith('workflows')) {
        return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
      }
      return Promise.resolve(['README.md']) as unknown as ReturnType<
        typeof readdir
      >
    })

    let result = await scanGitHubActions('.')
    expect(result.compositeActions.size).toBe(0)
    expect(result.actions).toHaveLength(0)
  })

  it('handles actions path that exists but is not a directory', async () => {
    vi.mocked(stat).mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.endsWith('workflows')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      return Promise.resolve({ isDirectory: () => false } as Stats)
    })

    vi.mocked(readdir).mockResolvedValue([])

    let result = await scanGitHubActions('.')
    expect(result.compositeActions.size).toBe(0)
  })

  it('scans custom directory when ciDirectory parameter is provided', async () => {
    vi.mocked(stat).mockResolvedValue({
      isDirectory: () => true,
    } as Stats)

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      if (typeof path === 'string' && path.includes('workflows')) {
        return Promise.resolve(['ci.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      if (typeof path === 'string' && path.includes('actions')) {
        return Promise.resolve(['build']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockResolvedValue('content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument({
        runs: {
          steps: [{ uses: 'actions/setup-node@v5' }],
          using: 'composite',
        },
        jobs: { build: { steps: [{ uses: 'actions/checkout@v4' }] } },
      }) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanGitHubActions('.', '.gitea')

    expect(result.workflows.has('.gitea/workflows/ci.yml')).toBeTruthy()
    expect(result.compositeActions.get('build')).toBe('.gitea/actions/build')
  })

  it('handles same-repo composite action with empty nested actions', async () => {
    process.env['GITHUB_REPOSITORY'] = 'test/repo'

    vi.mocked(stat).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.github/workflows')) {
        return Promise.resolve({ isDirectory: () => true } as Stats)
      }
      if (currentPath.endsWith('.github/actions')) {
        return Promise.resolve({ isDirectory: () => false } as Stats)
      }
      if (currentPath.endsWith('empty-action/action.yml')) {
        return Promise.resolve({
          isDirectory: () => false,
          isFile: () => true,
        } as unknown as Stats)
      }
      return Promise.reject(new Error('ENOENT'))
    })

    vi.mocked(readdir).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.github/workflows')) {
        return Promise.resolve(['test.yml']) as unknown as ReturnType<
          typeof readdir
        >
      }
      return Promise.resolve([]) as unknown as ReturnType<typeof readdir>
    })

    vi.mocked(readFile).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('test.yml')) {
        return Promise.resolve('workflow') as unknown as ReturnType<
          typeof readFile
        >
      }
      if (currentPath.endsWith('empty-action/action.yml')) {
        return Promise.resolve('action') as unknown as ReturnType<
          typeof readFile
        >
      }
      return Promise.reject(new Error('not found'))
    })

    vi.mocked(parseDocument).mockImplementation((content: string) => {
      if (content === 'workflow') {
        return createMockDocument({
          jobs: {
            test: {
              steps: [{ uses: 'test/repo/empty-action@v1' }],
            },
          },
        }) as unknown as ReturnType<typeof parseDocument>
      }
      if (content === 'action') {
        return createMockDocument({
          runs: {
            using: 'composite',
            steps: [],
          },
        }) as unknown as ReturnType<typeof parseDocument>
      }
      return createMockDocument({}) as unknown as ReturnType<
        typeof parseDocument
      >
    })

    let result = await scanGitHubActions('.')
    expect(result.workflows.size).toBe(1)
    expect(result.actions).toHaveLength(1)

    delete process.env['GITHUB_REPOSITORY']
  })

  it('handles git config url without groups match', async () => {
    delete process.env['GITHUB_REPOSITORY']

    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))

    vi.mocked(readFile).mockImplementation((path: unknown) => {
      let currentPath = String(path)
      if (currentPath.endsWith('.git/config')) {
        return Promise.resolve(
          '[remote "origin"]\n' +
            '    url = invalid-url-format\n' +
            '    fetch = +refs/heads/*:refs/remotes/origin/*\n',
        ) as unknown as ReturnType<typeof readFile>
      }
      return Promise.reject(new Error('not used'))
    })

    let result = await scanGitHubActions('.')
    expect(result.actions).toEqual([])
  })
})
