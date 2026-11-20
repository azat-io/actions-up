import type { PathLike } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { realpath, readFile, stat } from 'node:fs/promises'

import type {
  FakeFileSystem,
  FakeEntry,
} from '../../helpers/create-fake-file-system'

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
  vi.mocked<FakeFileSystem['stat']>(stat).mockImplementation(fileSystem.stat)
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

    expect(reached).toStrictEqual(
      new Map([
        [
          LINT_ACTION,
          new Map([
            [RELEASE_WORKFLOW, false],
            [CI_WORKFLOW, true],
          ]),
        ],
        [SETUP_ACTION, new Map([[CI_WORKFLOW, true]])],
      ]),
    )
    expect(readFile).toHaveBeenCalledTimes(5)
  })

  it('records an action only under the workflows that reach it through $/ references alone', async () => {
    installFileSystem({
      [SETUP_ACTION]: makeActionText('./tools/lint', '../repo/tools/lint'),
      [RELEASE_WORKFLOW]: makeWorkflowText('./.github/actions/setup'),
      [CI_WORKFLOW]: makeWorkflowText('$/.github/actions/setup'),
      [DOCS_WORKFLOW]: makeWorkflowText('$/tools/lint'),
      [LINT_ACTION]: makeActionText('actions/cache@v4'),
    })

    let reached = await traceLocalActions(
      '/repo',
      new Set([RELEASE_WORKFLOW, DOCS_WORKFLOW, CI_WORKFLOW]),
    )

    expect(reached).toStrictEqual(
      new Map([
        [
          LINT_ACTION,
          new Map([
            [RELEASE_WORKFLOW, false],
            [DOCS_WORKFLOW, true],
            [CI_WORKFLOW, false],
          ]),
        ],
        [SETUP_ACTION, new Map([[CI_WORKFLOW, true]])],
      ]),
    )
  })

  it('lists a workflow that runs an action only through ./ when the action runs remote actions alone', async () => {
    installFileSystem({
      [SETUP_ACTION]: makeActionText('docker://alpine:3', './tools/lint'),
      [CI_WORKFLOW]: makeWorkflowText('./.github/actions/setup'),
      [LINT_ACTION]: makeActionText('actions/cache@v4'),
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(
      new Map([[LINT_ACTION, new Map([[CI_WORKFLOW, false]])]]),
    )
  })

  it('lists a workflow that runs through ./ an action the repository does not hold', async () => {
    installFileSystem({
      [CI_WORKFLOW]: makeWorkflowText(
        './tools/checked-out',
        './tools/empty',
        './.github/workflows/reusable.yml',
        './tools/container',
        './tools/legacy-container',
        '$/tools/missing',
      ),
      '/repo/tools/empty/readme.md': 'Filled while the workflow runs',
      '/repo/.github/workflows/reusable.yml': makeWorkflowText('$/'),
      '/repo/tools/legacy-container/dockerfile': 'FROM alpine:3\n',
      '/repo/tools/container/Dockerfile': 'FROM alpine:3\n',
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(
      new Map([
        ['/repo/tools/checked-out/action.yml', new Map([[CI_WORKFLOW, false]])],
        ['/repo/tools/empty/action.yml', new Map([[CI_WORKFLOW, false]])],
      ]),
    )
  })

  it('records an action for a workflow that reaches it through $/ after reaching it through ./', async () => {
    installFileSystem({
      [RELEASE_WORKFLOW]: makeWorkflowText(
        './tools/lint',
        '$/.github/actions/setup',
      ),
      [LINT_ACTION]: makeActionText('actions/cache@v4'),
      [CI_WORKFLOW]: makeWorkflowText('$/tools/lint'),
      [SETUP_ACTION]: makeActionText('$/tools/lint'),
    })

    let reached = await traceLocalActions(
      '/repo',
      new Set([RELEASE_WORKFLOW, CI_WORKFLOW]),
    )

    expect(reached).toStrictEqual(
      new Map([
        [
          LINT_ACTION,
          new Map([
            [RELEASE_WORKFLOW, true],
            [CI_WORKFLOW, true],
          ]),
        ],
        [SETUP_ACTION, new Map([[RELEASE_WORKFLOW, true]])],
      ]),
    )
  })

  it.each([
    ['$/ first', ['$/tools/lint', './tools/lint']],
    ['./ first', ['./tools/lint', '$/tools/lint']],
  ])(
    'records an action that one list of references reaches both ways, %s',
    async (_order, references) => {
      installFileSystem({
        [LINT_ACTION]: makeActionText('actions/cache@v4'),
        [CI_WORKFLOW]: makeWorkflowText(...references),
      })

      let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

      expect(reached).toStrictEqual(
        new Map([[LINT_ACTION, new Map([[CI_WORKFLOW, true]])]]),
      )
    },
  )

  it.each([
    ['$/ first', ['$/.github/actions/setup', './tools/other']],
    ['./ first', ['./tools/other', '$/.github/actions/setup']],
  ])(
    'records an action two actions run, one reached through $/ and one through ./, with %s',
    async (_order, references) => {
      installFileSystem({
        '/repo/tools/other/action.yml': makeActionText('$/tools/lint'),
        [LINT_ACTION]: makeActionText('actions/cache@v4'),
        [CI_WORKFLOW]: makeWorkflowText(...references),
        [SETUP_ACTION]: makeActionText('$/tools/lint'),
      })

      let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

      expect(reached?.get(LINT_ACTION)).toStrictEqual(
        new Map([[CI_WORKFLOW, true]]),
      )
    },
  )

  it('follows a local reference back to the action at the root of the repository', async () => {
    installFileSystem({
      [CI_WORKFLOW]: makeWorkflowText('./', '$/.github/actions/setup'),
      '/repo/action.yml': makeActionText('actions/setup-node@v4'),
      [SETUP_ACTION]: makeActionText('$/'),
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(
      new Map([
        ['/repo/action.yml', new Map([[CI_WORKFLOW, true]])],
        [SETUP_ACTION, new Map([[CI_WORKFLOW, true]])],
      ]),
    )
  })

  it('names an action by the real path of its definition', async () => {
    installFileSystem({
      '/repo/shared/setup/action.yml': makeActionText('actions/cache@v4'),
      [SETUP_ACTION]: fakeSymlink('/repo/shared/setup/action.yml'),
      [CI_WORKFLOW]: makeWorkflowText('./.github/actions/setup'),
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(
      new Map([
        ['/repo/shared/setup/action.yml', new Map([[CI_WORKFLOW, false]])],
      ]),
    )
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
      recording: new Map([[CI_WORKFLOW, false]]),
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
      recording: new Map([[CI_WORKFLOW, true]]),
    },
  ])('follows a reference $reference', async ({ recording, text }) => {
    installFileSystem({
      [SETUP_ACTION]: makeActionText('actions/cache@v4'),
      [CI_WORKFLOW]: text,
    })

    let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

    expect(reached).toStrictEqual(new Map([[SETUP_ACTION, recording]]))
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

    expect(reached).toStrictEqual(new Map())
  })

  it('ignores a tracked workflow that no longer exists', async () => {
    installFileSystem({
      [RELEASE_WORKFLOW]: makeWorkflowText('actions/checkout@v4'),
    })

    let reached = await traceLocalActions(
      '/repo',
      new Set([RELEASE_WORKFLOW, CI_WORKFLOW]),
    )

    expect(reached).toStrictEqual(new Map())
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
    {
      reference: '$/.github/actions/setup',
      definition: 'cannot be read',
      entry: fakeUnreadableFile(),
    },
    {
      reference: '$/.github/actions/setup',
      definition: 'is not valid YAML',
      entry: 'runs: [\n',
    },
    {
      definition: 'reached through ./ is not valid YAML',
      reference: './.github/actions/setup',
      entry: 'runs: [\n',
    },
  ])(
    'lets any action be reached when the definition of a reached one $definition',
    async ({ reference, entry }) => {
      installFileSystem({
        [CI_WORKFLOW]: makeWorkflowText(reference),
        [SETUP_ACTION]: entry,
      })

      let reached = await traceLocalActions('/repo', new Set([CI_WORKFLOW]))

      expect(reached).toBeNull()
    },
  )
})
