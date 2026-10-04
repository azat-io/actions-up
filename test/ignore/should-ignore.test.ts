import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

import { createFakeFileSystem } from '../helpers/create-fake-file-system'
import { shouldIgnore } from '../../core/ignore/should-ignore'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}))

/**
 * Serve `readFile` from an in-memory tree holding a single workflow file.
 *
 * @param filePath - Absolute path of the workflow file.
 * @param lines - Lines of the workflow file.
 */
function installWorkflow(filePath: string, lines: string[]): void {
  let fileSystem = createFakeFileSystem({ [filePath]: lines.join('\n') })
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
}

describe('shouldIgnore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns false when the file path is missing', async () => {
    let ignored = await shouldIgnore(undefined, 5)

    expect(ignored).toBeFalsy()
  })

  it.each([
    { position: 'a line above the directive', line: 1 },
    { position: 'a step below the directive', line: 7 },
    { position: 'a missing line', line: undefined },
  ])(
    'ignores $position in a file marked actions-up-ignore-file',
    async ({ line }) => {
      let filePath = '/repo/.github/workflows/ci.yml'
      installWorkflow(filePath, [
        'name: CI',
        '# actions-up-ignore-file',
        'on: push',
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
      ])

      let ignored = await shouldIgnore(filePath, line)

      expect(ignored).toBeTruthy()
    },
  )

  it('only the file-level ignore applies when the line is unknown', async () => {
    let filePath = '/repo/.github/workflows/ci.yml'
    installWorkflow(filePath, [
      'on: push',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v3',
    ])

    let ignored = await shouldIgnore(filePath, undefined)

    expect(ignored).toBeFalsy()
  })

  it.each([
    { role: 'the directive line', ignored: false, line: 4 },
    { role: 'the line right after it', ignored: true, line: 5 },
    { role: 'the line after that', ignored: false, line: 6 },
  ])(
    'ignores only the line right after actions-up-ignore-next-line: $role is ignored: $ignored',
    async ({ ignored: expected, line }) => {
      let filePath = '/repo/.github/workflows/next-line.yml'
      installWorkflow(filePath, [
        'jobs:',
        '  build:',
        '    steps:',
        '      # actions-up-ignore-next-line',
        '      - uses: actions/checkout@v3',
        '      - uses: actions/setup-node@v4',
      ])

      let ignored = await shouldIgnore(filePath, line)

      expect(ignored).toBe(expected)
    },
  )

  it('does not carry actions-up-ignore-next-line over a blank line', async () => {
    let filePath = '/repo/.github/workflows/next-line-blank.yml'
    installWorkflow(filePath, [
      'jobs:',
      '  build:',
      '    steps:',
      '      # actions-up-ignore-next-line',
      '',
      '      - uses: actions/checkout@v3',
    ])

    let ignored = await shouldIgnore(filePath, 6)

    expect(ignored).toBeFalsy()
  })

  it.each([
    { role: 'the line carrying the directive', ignored: true, line: 4 },
    { role: 'the line after it', ignored: false, line: 5 },
  ])(
    'ignores only the line carrying an inline actions-up-ignore: $role is ignored: $ignored',
    async ({ ignored: expected, line }) => {
      let filePath = '/repo/.github/workflows/inline.yml'
      installWorkflow(filePath, [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3 # actions-up-ignore',
        '      - uses: actions/setup-node@v4',
      ])

      let ignored = await shouldIgnore(filePath, line)

      expect(ignored).toBe(expected)
    },
  )

  it.each([
    { role: 'the line before the block', ignored: false, line: 3 },
    { role: 'the start directive', ignored: true, line: 4 },
    { role: 'the first step inside the block', ignored: true, line: 5 },
    { role: 'the last step inside the block', ignored: true, line: 6 },
    { role: 'the end directive', ignored: true, line: 7 },
    { role: 'the line after the block', ignored: false, line: 8 },
  ])(
    'ignores the lines from actions-up-ignore-start to actions-up-ignore-end inclusive: $role is ignored: $ignored',
    async ({ ignored: expected, line }) => {
      let filePath = '/repo/.github/workflows/block.yml'
      installWorkflow(filePath, [
        'jobs:',
        '  build:',
        '    steps:',
        '      # actions-up-ignore-start',
        '      - uses: actions/checkout@v3',
        '      - uses: actions/setup-node@v4',
        '      # actions-up-ignore-end',
        '      - run: echo "done"',
      ])

      let ignored = await shouldIgnore(filePath, line)

      expect(ignored).toBe(expected)
    },
  )
})
