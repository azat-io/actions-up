import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, lstat } from 'node:fs/promises'

import type { FakeEntry } from './helpers/create-fake-file-system'

import {
  createFakeFileSystem,
  fakeUnreadableFile,
} from './helpers/create-fake-file-system'
import { scanRecursive } from '../core/scan-recursive'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  lstat: vi.fn(),
}))

/**
 * Serve `readFile`, `readdir` and `lstat` from an in-memory tree for the
 * running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: Record<string, FakeEntry | string>): void {
  let fileSystem = createFakeFileSystem(entries)
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
  vi.mocked<(path: PathLike) => Promise<string[]>>(readdir).mockImplementation(
    fileSystem.readdir,
  )
  vi.mocked(lstat).mockImplementation(fileSystem.lstat)
}

/**
 * Text of an issue form: it has a `name` like a workflow or an action, but no
 * `jobs` and no `runs`.
 *
 * @returns Issue form YAML text.
 */
function makeIssueFormText(): string {
  return [
    'name: Bug report',
    'description: Report a problem',
    'labels: [bug]',
    'body:',
    '  - type: textarea',
    '    attributes:',
    '      label: What happened?',
    '',
  ].join('\n')
}

/**
 * Text of a composite action whose only step uses one action, on line 6.
 *
 * @param uses - Action reference of the step.
 * @returns Composite action YAML text.
 */
function makeCompositeActionText(uses: string): string {
  return [
    'name: Setup',
    'description: Install the toolchain',
    'runs:',
    '  using: composite',
    '  steps:',
    `    - uses: ${uses}`,
    '',
  ].join('\n')
}

/**
 * Text of a workflow whose `test` job uses one action, on line 7.
 *
 * @param uses - Action reference of the step.
 * @returns Workflow YAML text.
 */
function makeWorkflowText(uses: string): string {
  return [
    'name: CI',
    'on: push',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    `      - uses: ${uses}`,
    '',
  ].join('\n')
}

describe('scanRecursive', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reports the workflows found at any depth by their path relative to the root', async () => {
    installFileSystem({
      '/repo/templates/deploy.yml': makeWorkflowText(
        'actions/download-artifact@v4',
      ),
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
      '/repo/.github/ISSUE_TEMPLATE/bug.yml': makeIssueFormText(),
      '/repo/README.md': '# Demo\n',
    })

    let result = await scanRecursive('/repo', '.')

    expect(result.workflows).toStrictEqual(
      new Map([
        [
          'templates/deploy.yml',
          [
            {
              uses: 'actions/download-artifact@v4',
              ref: 'actions/download-artifact@v4',
              file: '/repo/templates/deploy.yml',
              name: 'actions/download-artifact',
              type: 'external',
              version: 'v4',
              job: 'test',
              line: 7,
            },
          ],
        ],
        [
          '.github/workflows/ci.yml',
          [
            {
              file: '/repo/.github/workflows/ci.yml',
              uses: 'actions/checkout@v4',
              ref: 'actions/checkout@v4',
              name: 'actions/checkout',
              type: 'external',
              version: 'v4',
              job: 'test',
              line: 7,
            },
          ],
        ],
      ]),
    )
  })

  it.each([
    ['/repo/.github/actions/setup/action.yml', '.github/actions/setup'],
    ['/repo/tools/lint/action.yaml', 'tools/lint'],
    ['/repo/action.yml', 'action.yml'],
  ])(
    'registers the composite action %s under the name %s',
    async (filePath, expectedName) => {
      installFileSystem({
        [filePath]: makeCompositeActionText('actions/setup-node@v4'),
      })

      let result = await scanRecursive('/repo', '.')

      expect(result.compositeActions.keys().toArray()).toStrictEqual([
        expectedName,
      ])
    },
  )

  it('collects the actions of every workflow and composite action', async () => {
    installFileSystem({
      '/repo/.github/actions/setup/action.yml': makeCompositeActionText(
        'actions/setup-node@v4',
      ),
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
    })

    let result = await scanRecursive('/repo', '.')

    expect(result.actions).toHaveLength(2)
    expect(result.actions).toContainEqual({
      file: '/repo/.github/workflows/ci.yml',
      uses: 'actions/checkout@v4',
      ref: 'actions/checkout@v4',
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
      job: 'test',
      line: 7,
    })
    expect(result.actions).toContainEqual({
      file: '/repo/.github/actions/setup/action.yml',
      uses: 'actions/setup-node@v4',
      ref: 'actions/setup-node@v4',
      name: 'actions/setup-node',
      type: 'external',
      version: 'v4',
      line: 6,
    })
  })

  it('does not classify YAML files that are neither workflows nor composite actions', async () => {
    installFileSystem({
      '/repo/.github/dependabot.yml': [
        'version: 2',
        'updates:',
        '  - package-ecosystem: github-actions',
        '    directory: /',
        '    schedule:',
        '      interval: weekly',
        '',
      ].join('\n'),
      '/repo/.github/ISSUE_TEMPLATE/bug.yml': makeIssueFormText(),
    })

    let result = await scanRecursive('/repo', '.')

    expect(result).toStrictEqual({
      compositeActions: new Map(),
      workflows: new Map(),
      actions: [],
    })
  })

  it('skips a YAML file that cannot be read and keeps scanning the others', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
      '/repo/.github/workflows/broken.yml': fakeUnreadableFile(),
    })

    let result = await scanRecursive('/repo', '.')

    expect(result.workflows.keys().toArray()).toStrictEqual([
      '.github/workflows/ci.yml',
    ])
  })

  it('scans only the given directory and still reports paths relative to the root', async () => {
    installFileSystem({
      '/repo/gh-repo-defaults/workflows/ci.yml': makeWorkflowText(
        'actions/checkout@v4',
      ),
      '/repo/.github/workflows/release.yml': makeWorkflowText(
        'actions/setup-node@v4',
      ),
    })

    let result = await scanRecursive('/repo', 'gh-repo-defaults')

    expect(result.workflows.keys().toArray()).toStrictEqual([
      'gh-repo-defaults/workflows/ci.yml',
    ])
  })

  it('scans the whole root when the directory is empty', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
    })

    let result = await scanRecursive('/repo', '')

    expect(result.workflows.keys().toArray()).toStrictEqual([
      '.github/workflows/ci.yml',
    ])
  })

  it('returns an empty result when the directory does not exist', async () => {
    installFileSystem({
      '/repo/.github/workflows/ci.yml': makeWorkflowText('actions/checkout@v4'),
    })

    let result = await scanRecursive('/repo', 'missing')

    expect(result).toStrictEqual({
      compositeActions: new Map(),
      workflows: new Map(),
      actions: [],
    })
  })
})
