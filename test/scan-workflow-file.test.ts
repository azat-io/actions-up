import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'

import { scanWorkflowFile } from '../core/scan-workflow-file'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('yaml', () => ({
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
          items: array.map((item: unknown, index: number) => ({
            items: Object.entries(item as Record<string, unknown>).map(
              ([entryKey, entryValue]) =>
                createMockNode(entryKey, entryValue, [
                  index * 20,
                  index * 20 + 1,
                  index * 20 + 1,
                ]),
            ),
            toJSON: (): unknown => item,
          })),
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

describe('scanWorkflowFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scans workflow file with multiple jobs and steps', async () => {
    let mockWorkflow = {
      jobs: {
        build: {
          steps: [
            { uses: 'actions/checkout@v4' },
            { uses: 'actions/setup-node@v5' },
            { run: 'npm install' },
          ],
        },
        test: {
          steps: [
            { uses: 'actions/checkout@v4' },
            { uses: './.github/actions/test' },
          ],
        },
      },
    }

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/ci.yml')

    expect(result).toHaveLength(4)
    expect(result[0]).toMatchObject({
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
    })
    expect(result[1]).toMatchObject({
      name: 'actions/setup-node',
      type: 'external',
      version: 'v5',
    })
    expect(result[2]).toMatchObject({
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
    })
    expect(result[3]).toMatchObject({
      name: './.github/actions/test',
      type: 'local',
    })
  })

  it('handles workflow without jobs', async () => {
    let mockWorkflow = {
      name: 'Empty workflow',
    }

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/empty.yml')

    expect(result).toEqual([])
  })

  it('handles jobs without steps', async () => {
    let mockWorkflow = {
      jobs: {
        build: {
          runs: 'some script',
        },
        test: {
          steps: [],
        },
      },
    }

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/no-steps.yml')

    expect(result).toEqual([])
  })

  it('handles steps without uses field', async () => {
    let mockWorkflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "Hello"' }, { run: 'npm build', name: 'Build' }],
        },
      },
    }

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/no-uses.yml')

    expect(result).toEqual([])
  })

  it('throws error for invalid YAML', async () => {
    vi.mocked(readFile).mockResolvedValue('invalid: yaml: content')
    vi.mocked(parseDocument).mockImplementation(() => {
      throw new Error('Invalid YAML')
    })

    await expect(
      scanWorkflowFile('.github/workflows/invalid.yml'),
    ).rejects.toThrow('Invalid YAML')
  })

  it('throws error when file read fails', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('File not found'))

    await expect(
      scanWorkflowFile('.github/workflows/missing.yml'),
    ).rejects.toThrow('File not found')
  })

  it('returns empty array for null workflow content', async () => {
    vi.mocked(readFile).mockResolvedValue('')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(null) as unknown as ReturnType<typeof parseDocument>,
    )

    let result = await scanWorkflowFile('.github/workflows/null.yml')

    expect(result).toEqual([])
  })

  it('returns empty array for undefined workflow content', async () => {
    vi.mocked(readFile).mockResolvedValue('')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(undefined) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/undefined.yml')

    expect(result).toEqual([])
  })

  it('returns empty array when jobs node is not a YAML map', async () => {
    let mockWorkflow = {
      name: 'Invalid jobs node',
      jobs: 'should-be-a-map',
    }

    vi.mocked(readFile).mockResolvedValue('workflow with invalid jobs')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/invalid-jobs.yml')
    expect(result).toEqual([])
  })

  it('skips steps when steps node is not a YAML sequence', async () => {
    let mockWorkflow = {
      jobs: {
        build: {
          steps: 'not-an-array',
        },
      },
    }

    vi.mocked(readFile).mockResolvedValue('workflow with invalid steps node')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile(
      '.github/workflows/invalid-steps-node.yml',
    )
    expect(result).toEqual([])
  })

  it('ignores steps where uses is non-string (e.g., number)', async () => {
    let mockWorkflow = {
      jobs: {
        build: {
          steps: [{ uses: 123 }],
        },
      },
    }

    vi.mocked(readFile).mockResolvedValue('workflow with non-string uses')
    vi.mocked(parseDocument).mockReturnValue(
      createMockDocument(mockWorkflow) as unknown as ReturnType<
        typeof parseDocument
      >,
    )

    let result = await scanWorkflowFile('.github/workflows/non-string-uses.yml')
    expect(result).toEqual([])
  })

  it('skips job entries without toJSON and handles uses without range', async () => {
    let manualDocument = {
      contents: {
        items: [
          {
            value: {
              items: [
                {
                  key: { value: 'invalid' },
                  value: {},
                },
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
                              toJSON: () => ({ uses: 'actions/checkout@v4' }),
                            },
                          ],
                        },
                        key: { value: 'steps' },
                      },
                    ],
                    toJSON: () => ({
                      steps: [{ uses: 'actions/checkout@v4' }],
                    }),
                  },
                  key: { value: 'valid' },
                },
              ],
            },
            key: { value: 'jobs' },
          },
        ],
      },
      toJSON: () => ({
        jobs: { valid: { steps: [{ uses: 'actions/checkout@v4' }] } },
      }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/manual.yml')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'actions/checkout', version: 'v4' })
  })

  it('returns empty when jobs pair has undefined value', async () => {
    let manualDocument = {
      contents: {
        items: [
          {
            value: {
              items: [{ key: { value: 'jobs' } }],
            },
            key: { value: 'jobs' },
          },
        ],
      },
      toJSON: () => ({ jobs: {} }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/undefined-job.yml')
    expect(result).toEqual([])
  })

  it('skips job node that is not a YAML map (has toJSON but no items)', async () => {
    let manualDocument = {
      contents: {
        items: [
          {
            value: {
              items: [
                {
                  value: {
                    toJSON: () => ({ steps: [] }),
                  },
                  key: { value: 'weird' },
                },
              ],
            },
            key: { value: 'jobs' },
          },
        ],
      },
      toJSON: () => ({ jobs: { weird: { steps: [] } } }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/not-map-job.yml')
    expect(result).toEqual([])
  })

  it('continues when JSON has steps array but AST steps is not a YAML sequence', async () => {
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
                        key: { value: 'steps' },
                        value: 'wrong-type',
                      },
                    ],
                    toJSON: () => ({
                      steps: [{ uses: 'actions/checkout@v4' }],
                    }),
                  },
                  key: { value: 'build' },
                },
              ],
            },
            key: { value: 'jobs' },
          },
        ],
      },
      toJSON: () => ({
        jobs: { build: { steps: [{ uses: 'actions/checkout@v4' }] } },
      }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/ast-not-seq.yml')
    expect(result).toEqual([])
  })

  it('skips step node that lacks toJSON (YAML map without Node)', async () => {
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
                    toJSON: () => ({
                      steps: [{ uses: 'actions/checkout@v4' }],
                    }),
                  },
                  key: { value: 'build' },
                },
              ],
            },
            key: { value: 'jobs' },
          },
        ],
      },
      toJSON: () => ({
        jobs: { build: { steps: [{ uses: 'actions/checkout@v4' }] } },
      }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/step-not-node.yml')
    expect(result).toEqual([])
  })

  it('returns empty when document contents is missing', async () => {
    let manualDocument = {
      toJSON: () => ({
        jobs: { test: { steps: [{ uses: 'actions/checkout@v4' }] } },
      }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/no-contents.yml')
    expect(result).toEqual([])
  })

  it('handles uses key without range property and with undefined range', async () => {
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
                        value: {
                          items: [
                            {
                              items: [
                                {
                                  value: 'actions/checkout@v4',
                                  key: { value: 'uses' },
                                },
                              ],
                              toJSON: () => ({ uses: 'actions/checkout@v4' }),
                            },
                            {
                              items: [
                                {
                                  key: { range: undefined, value: 'uses' },
                                  value: 'actions/setup-node@v5',
                                },
                              ],
                              toJSON: () => ({ uses: 'actions/setup-node@v5' }),
                            },
                          ],
                        },
                        key: { value: 'steps' },
                      },
                    ],
                    toJSON: () => ({
                      steps: [
                        { uses: 'actions/checkout@v4' },
                        { uses: 'actions/setup-node@v5' },
                      ],
                    }),
                  },
                  key: { value: 'build' },
                },
              ],
            },
            key: { value: 'jobs' },
          },
        ],
      },
      toJSON: () => ({
        jobs: {
          build: {
            steps: [
              { uses: 'actions/checkout@v4' },
              { uses: 'actions/setup-node@v5' },
            ],
          },
        },
      }),
    } as unknown as ReturnType<typeof parseDocument>

    vi.mocked(readFile).mockResolvedValue('workflow content')
    vi.mocked(parseDocument).mockReturnValue(manualDocument)

    let result = await scanWorkflowFile('.github/workflows/uses-no-range.yml')
    expect(result).toHaveLength(2)
  })
})
