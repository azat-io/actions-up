import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { realpath, readFile, stat } from 'node:fs/promises'

import type { FakeEntry } from '../../helpers/create-fake-file-system'

import {
  createFakeFileSystem,
  fakeUnreadableFile,
  fakeDirectory,
  fakeSymlink,
} from '../../helpers/create-fake-file-system'
import { traceLocalActions } from '../../../core/lockfile/trace-local-actions'

vi.mock(import('node:fs/promises'), () => ({
  realpath: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}))

const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

const RELEASE_WORKFLOW = '/repo/.github/workflows/release.yml'

const DOCS_WORKFLOW = '/repo/.github/workflows/docs.yml'

const SETUP_ACTION = '/repo/.github/actions/setup/action.yml'

const LINT_ACTION = '/repo/tools/lint/action.yaml'

/**
 * Serve `readFile`, `realpath` and `stat` from an in-memory tree for the
 * running test.
 *
 * @param entries - Absolute paths mapped to file text or special entries.
 */
function installFileSystem(entries: Record<string, FakeEntry | string>): void {
  let fileSystem = createFakeFileSystem(entries)
  vi.mocked(readFile).mockImplementation((path, options) =>
    fileSystem.readFile(path as PathLike, options),
  )
  vi.mocked(realpath).mockImplementation(path => fileSystem.realpath(path))
  vi.mocked(stat).mockImplementation(fileSystem.stat)
}

/**
 * Text of a composite action with one step per reference.
 *
 * @param references - References of the steps.
 * @returns Composite action YAML text.
 */
function makeActionText(...references: string[]): string {
  return [
    'name: Shared',
    'description: Shared steps',
    'runs:',
    '  using: composite',
    '  steps:',
    ...references.map(reference => `    - uses: ${reference}`),
    '',
  ].join('\n')
}

/**
 * Text of a workflow whose job has one step per reference.
 *
 * @param references - References of the steps.
 * @returns Workflow YAML text.
 */
function makeWorkflowText(...references: string[]): string {
  return [
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...references.map(reference => `      - uses: ${reference}`),
    '',
  ].join('\n')
}

describe('traceLocalActions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('follows local references from the tracked workflows through the actions they run, reading each action once', async () => {
    installFileSystem({
      [SETUP_ACTION]: makeActionText(
        'actions/setup-node@v4',
        '$/tools/lint/',
        '$/.github/actions/setup',
      ),
      [CI_WORKFLOW]: makeWorkflowText(
        'actions/checkout@v4',
        '$/.github/actions/setup',
      ),
      [DOCS_WORKFLOW]: makeWorkflowText('actions/checkout@v4'),
      [RELEASE_WORKFLOW]: makeWorkflowText('./tools/lint'),
      [LINT_ACTION]: makeActionText('actions/cache@v4'),
    })

    let reached = await traceLocalActions(
      '/repo',
      new Set([RELEASE_WORKFLOW, DOCS_WORKFLOW, CI_WORKFLOW]),
    )

    expect(reached).toStrictEqual(new Set([SETUP_ACTION, LINT_ACTION]))
    expect(readFile).toHaveBeenCalledTimes(5)
  })

  it('follows a local reference back to the action at the root of the repository', async () => {
    installFileSystem({
      [CI_WORKFLOW]: makeWorkflowText('./', '$/.github/actions/setup'),
      '/repo/action.yml': makeActionText('actions/setup-node@v4'),
      [SETUP_ACTION]: makeActionText('$/'),
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(new Set(['/repo/action.yml', SETUP_ACTION]))
  })

  it('names an action by the real path of its definition', async () => {
    installFileSystem({
      '/repo/shared/setup/action.yml': makeActionText('actions/cache@v4'),
      [SETUP_ACTION]: fakeSymlink('/repo/shared/setup/action.yml'),
      [CI_WORKFLOW]: makeWorkflowText('./.github/actions/setup'),
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(new Set(['/repo/shared/setup/action.yml']))
  })

  it.each([
    {
      text: [
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    env:',
        '      SETUP: &setup ./.github/actions/setup',
        '    steps:',
        '      - uses: *setup',
        '',
      ].join('\n'),
      reference: 'written through a YAML alias',
    },
    {
      text: [
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - parallel:',
        '          - uses: $/.github/actions/setup',
        '          - run: echo lint',
        '',
      ].join('\n'),
      reference: 'in a parallel group of steps',
    },
  ])('follows a reference $reference', async ({ text }) => {
    installFileSystem({
      [SETUP_ACTION]: makeActionText('actions/cache@v4'),
      [CI_WORKFLOW]: text,
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(new Set([SETUP_ACTION]))
  })

  it('reaches no action through a reference that leaves the repository or holds no definition', async () => {
    installFileSystem({
      [CI_WORKFLOW]: makeWorkflowText(
        '$/../outside',
        '$/.github/actions/missing',
        '$/.github/actions/folder',
        './.github/workflows/reusable.yml',
      ),
      '/repo/.github/workflows/reusable.yml': makeWorkflowText('$/'),
      '/repo/.github/actions/folder/action.yml': fakeDirectory(),
      '/outside/action.yml': makeActionText('actions/cache@v4'),
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(new Set())
  })

  it('ignores a tracked workflow that no longer exists', async () => {
    installFileSystem({
      [RELEASE_WORKFLOW]: makeWorkflowText('actions/checkout@v4'),
    })

    let reached = await traceLocalActions(
      '/repo',
      new Set([RELEASE_WORKFLOW, CI_WORKFLOW]),
    )

    expect(reached).toStrictEqual(new Set())
  })

  it.each([
    { entry: fakeUnreadableFile(), workflow: 'cannot be read' },
    { workflow: 'is not valid YAML', entry: 'jobs: [\n' },
    {
      entry: [
        'a: &a [x, x, x, x, x, x, x, x, x, x]',
        `b: &b [${Array.from({ length: 10 }, () => '*a').join(', ')}]`,
        `c: &c [${Array.from({ length: 10 }, () => '*b').join(', ')}]`,
        `d: [${Array.from({ length: 10 }, () => '*c').join(', ')}]`,
        '',
      ].join('\n'),
      workflow: 'expands its aliases beyond reason',
    },
  ])(
    'lets any action be reached when a tracked workflow $workflow',
    async ({ entry }) => {
      installFileSystem({ [CI_WORKFLOW]: entry })

      let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

      expect(reached).toBeNull()
    },
  )

  it('lets any action be reached when the definition of a reached one cannot be looked for', async () => {
    installFileSystem({
      [CI_WORKFLOW]: makeWorkflowText('$/.github/actions/setup'),
      [LINT_ACTION]: makeActionText('actions/cache@v4'),
      [SETUP_ACTION]: makeActionText('$/tools/lint'),
    })
    let lookUp = vi.mocked(stat).getMockImplementation()!
    vi.mocked(stat).mockImplementation(path =>
      String(path) === SETUP_ACTION ?
        Promise.reject(
          Object.assign(new Error('EACCES: permission denied'), {
            code: 'EACCES',
          }),
        )
      : lookUp(path),
    )

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toBeNull()
  })

  it.each([
    { definition: 'cannot be read', entry: fakeUnreadableFile() },
    { definition: 'is not valid YAML', entry: 'runs: [\n' },
  ])(
    'lets any action be reached when the definition of a reached one $definition',
    async ({ entry }) => {
      installFileSystem({
        [CI_WORKFLOW]: makeWorkflowText('$/.github/actions/setup'),
        [SETUP_ACTION]: entry,
      })

      let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

      expect(reached).toBeNull()
    },
  )
})
