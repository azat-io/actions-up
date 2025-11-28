import { beforeEach, describe, expect, it, vi } from 'vitest'

import { shouldIgnore } from '../../core/ignore/should-ignore'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}))

describe('shouldIgnore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when file has actions-up-ignore-file', async () => {
    let filePath = '/repo/.github/workflows/ci.yml'
    let content = ['name: CI', '# actions-up-ignore-file', 'jobs:'].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 10)).resolves.toBeTruthy()
  })

  it('returns false when file path is missing', async () => {
    let { readFile } = await import('node:fs/promises')
    await expect(shouldIgnore(undefined, 5)).resolves.toBeFalsy()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('ignores the immediate next physical line after actions-up-ignore-next-line', async () => {
    let filePath = '/repo/.github/workflows/next-line.yml'
    let content = [
      'jobs:',
      '  build:',
      '    steps:',
      '      # actions-up-ignore-next-line', // Line 4
      '      - uses: actions/checkout@v3', // Line 5
      '      - run: echo "hi"', // Line 6
    ].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 5)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 4)).resolves.toBeFalsy()
    await expect(shouldIgnore(filePath, 6)).resolves.toBeFalsy()
  })

  it('does not skip through blank line for next-line', async () => {
    let filePath = '/repo/.github/workflows/next-line-blank.yml'
    let content = [
      'jobs:',
      '  build:',
      '    steps:',
      '      # actions-up-ignore-next-line', // Line 4 -> next is 5
      '', // Line 5 (blank)
      '      - uses: actions/checkout@v3', // Line 6 (should NOT be ignored)
    ].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 6)).resolves.toBeFalsy()
    await expect(shouldIgnore(filePath, 5)).resolves.toBeTruthy()
  })

  it('ignores the same line when inline actions-up-ignore is present', async () => {
    let filePath = '/repo/.github/workflows/inline.yml'
    let content = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v3 # actions-up-ignore', // Line 4
      '      - run: echo "hi"',
    ].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 4)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 5)).resolves.toBeFalsy()
  })

  it('ignores lines inside block from start to end inclusive', async () => {
    let filePath = '/repo/.github/workflows/block.yml'
    let content = [
      'jobs:', // 1
      '  build:', // 2
      '    steps:', // 3
      '      # actions-up-ignore-start', // 4
      '      - uses: actions/checkout@v3', // 5
      '      - uses: actions/setup-node@v4', // 6
      '      # actions-up-ignore-end', // 7
      '      - run: echo "done"', // 8
    ].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 4)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 5)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 6)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 7)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 8)).resolves.toBeFalsy()
  })

  it('file-level ignore has priority even when line is outside block', async () => {
    let filePath = '/repo/.github/workflows/priority.yml'
    let content = [
      '# actions-up-ignore-file',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v3',
    ].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 5)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 1)).resolves.toBeTruthy()
    await expect(shouldIgnore(filePath, 0)).resolves.toBeTruthy()
  })

  it('when line is missing or <= 0, only file-level ignore applies', async () => {
    let filePath = '/repo/.github/workflows/no-line.yml'
    let content = [
      'jobs:',
      '  build:',
      '    steps:',
      '      # actions-up-ignore-next-line',
      '      - uses: actions/checkout@v3',
    ].join('\n')

    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(content)

    await expect(shouldIgnore(filePath, 0)).resolves.toBeFalsy()
    await expect(shouldIgnore(filePath, undefined)).resolves.toBeFalsy()
  })
})
