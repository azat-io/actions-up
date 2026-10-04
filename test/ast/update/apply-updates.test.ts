import type { PathLike } from 'node:fs'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'

import type { FakeFileSystem } from '../../helpers/create-fake-file-system'
import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'

import { createFakeFileSystem } from '../../helpers/create-fake-file-system'
import { applyUpdates } from '../../../core/ast/update/apply-updates'

vi.mock(import('node:fs/promises'), () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
}))

/**
 * Fields of an update to change; the scanned action is merged field by field.
 */
interface UpdateOverrides extends Partial<Omit<ActionUpdate, 'action'>> {
  /**
   * Fields of the scanned action to change.
   */
  action?: Partial<GitHubAction>
}

describe('applyUpdates', () => {
  let workflowPath = '/repo/.github/workflows/ci.yml'
  let checkoutSha = '11bd71901bbe5b1630ceea73d27597364c9af683'
  let setupNodeSha = '49933ea5288caeca8642d1e84afbd3f7d6820020'

  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Serve files from an in-memory file system through `node:fs/promises`.
   *
   * Like the real `readFile`, the text comes back only when an encoding is
   * requested; otherwise the caller gets the raw bytes.
   *
   * @param files - Absolute paths mapped to file text.
   * @returns File system holding the text the updater writes.
   */
  function installFiles(files: Record<string, string>): FakeFileSystem {
    let fileSystem = createFakeFileSystem(files)
    vi.mocked(readFile).mockImplementation((path, options) =>
      fileSystem.readFile(path as PathLike, options),
    )
    vi.mocked(writeFile).mockImplementation((path, content) =>
      fileSystem.writeFile(path as PathLike, content as string),
    )
    return fileSystem
  }

  /**
   * Line on which `workflowWithStep` puts the step under update, and the line
   * `createUpdate` records as the one the step was scanned from.
   */
  let stepLine = 4

  /**
   * First line number past the end of a file built by `workflowWithStep`.
   */
  let lineAfterStepWorkflow = 7

  /**
   * Build an update the way the CLI passes it on once the target is resolved:
   * the `actions/checkout@v3` step scanned on `stepLine`, pinned to v4.2.2.
   *
   * @param overrides - Fields to change.
   * @returns Update entry.
   */
  function createUpdate(overrides: UpdateOverrides = {}): ActionUpdate {
    let { action, ...update } = overrides
    return {
      latestVersion: 'v4.2.2',
      latestSha: checkoutSha,
      targetRef: checkoutSha,
      targetRefStyle: 'sha',
      currentRefType: 'tag',
      currentVersion: 'v3',
      publishedAt: null,
      isBreaking: true,
      hasUpdate: true,
      status: 'ok',
      ...update,
      action: {
        name: 'actions/checkout',
        file: workflowPath,
        type: 'external',
        line: stepLine,
        version: 'v3',
        ...action,
      },
    }
  }

  /**
   * Build an update that pins an `actions/setup-node@v3` step to v4.4.0.
   *
   * @param line - Line the step was scanned on.
   * @returns Update entry.
   */
  function createSetupNodeUpdate(line: number): ActionUpdate {
    return createUpdate({
      action: { name: 'actions/setup-node', line },
      latestVersion: 'v4.4.0',
      latestSha: setupNodeSha,
      targetRef: setupNodeSha,
    })
  }

  /**
   * Build a workflow whose `build` job runs the given step on `stepLine`.
   *
   * @param step - Line holding the step under update.
   * @returns Workflow YAML text.
   */
  function workflowWithStep(step: string): string {
    return [
      'jobs:',
      '  build:',
      '    steps:',
      step,
      '      - run: npm test',
      '',
    ].join('\n')
  }

  it('pins the scanned step to the target SHA and notes the version in a comment', async () => {
    let fileSystem = installFiles({
      [workflowPath]: [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - run: npm test',
        '',
      ].join('\n'),
    })

    await applyUpdates([createUpdate()])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
        '      - run: npm test',
        '',
      ].join('\n'),
    )
  })

  it.each([
    [
      'a single-quoted reference',
      "      - uses: 'actions/checkout@v3'",
      "      - uses: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683' # v4.2.2",
    ],
    [
      'a double-quoted reference',
      '      - uses: "actions/checkout@v3"',
      '      - uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683" # v4.2.2',
    ],
    [
      'a reference with a comment',
      '      - uses: actions/checkout@v3 # pinned by hand',
      '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
    ],
    [
      'a double-quoted reference with a comment',
      '      - uses: "actions/checkout@v3" # pinned by hand',
      '      - uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683" # v4.2.2',
    ],
  ])(
    'pins %s and puts the version comment in place of any other',
    async (_description, step, expectedStep) => {
      let fileSystem = installFiles({ [workflowPath]: workflowWithStep(step) })

      await applyUpdates([createUpdate()])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        workflowWithStep(expectedStep),
      )
    },
  )

  it.each([
    [
      'a plain reference',
      '      - uses: &checkout actions/checkout@v3 # v3.6.0',
      '      - uses: &checkout actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
    ],
    [
      'a quoted reference',
      "      - uses: &checkout 'actions/checkout@v3'",
      "      - uses: &checkout 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683' # v4.2.2",
    ],
    [
      'a reference in a flow mapping',
      '      - { uses: &checkout actions/checkout@v3 }',
      '      - { uses: &checkout actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 } # v4.2.2',
    ],
  ])(
    'pins %s that carries an anchor and keeps the anchor for its aliases',
    async (_description, step, expectedStep) => {
      let alias = '      - uses: *checkout'
      let fileSystem = installFiles({
        [workflowPath]: [
          'jobs:',
          '  build:',
          '    steps:',
          step,
          alias,
          '',
        ].join('\n'),
      })

      await applyUpdates([createUpdate()])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        ['jobs:', '  build:', '    steps:', expectedStep, alias, ''].join('\n'),
      )
    },
  )

  it('keeps CRLF line endings and the comment on the next line', async () => {
    let fileSystem = installFiles({
      [workflowPath]: [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      # keep me',
        '      - run: npm test',
        '',
      ].join('\r\n'),
    })

    await applyUpdates([createUpdate()])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
        '      # keep me',
        '      - run: npm test',
        '',
      ].join('\r\n'),
    )
  })

  it('applies each update to its own line of the same file', async () => {
    let fileSystem = installFiles({
      [workflowPath]: [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - uses: "actions/setup-node@v3"',
        '',
      ].join('\n'),
    })

    await applyUpdates([createUpdate(), createSetupNodeUpdate(5)])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
        '      - uses: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020" # v4.4.0',
        '',
      ].join('\n'),
    )
  })

  it('updates flow-style steps with quoted uses keys and keeps their delimiters', async () => {
    let fileSystem = installFiles({
      [workflowPath]: [
        '# flow-style steps',
        'steps:',
        "  - { 'uses': 'actions/checkout@v3' }",
        "  - { 'uses': 'actions/setup-node@v3' }",
        '',
      ].join('\n'),
    })

    await applyUpdates([
      createUpdate({ action: { line: 3 } }),
      createSetupNodeUpdate(4),
    ])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      [
        '# flow-style steps',
        'steps:',
        "  - { 'uses': 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683' } # v4.2.2",
        "  - { 'uses': 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020' } # v4.4.0",
        '',
      ].join('\n'),
    )
  })

  it('adds no version comment when more of the step follows on the same line', async () => {
    let fileSystem = installFiles({
      [workflowPath]:
        "steps: [ { 'uses': 'actions/checkout@v3', 'name': 'Checkout' } ]\n",
    })

    await applyUpdates([createUpdate({ action: { line: 1 } })])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      "steps: [ { 'uses': 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683', 'name': 'Checkout' } ]\n",
    )
  })

  it('writes a file once however many of its references are updated', async () => {
    installFiles({
      [workflowPath]: [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - uses: actions/setup-node@v3',
        '',
      ].join('\n'),
    })

    await applyUpdates([createUpdate(), createSetupNodeUpdate(5)])

    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      workflowPath,
      expect.any(String),
      'utf8',
    )
  })

  it('rewrites only the occurrence the update was scanned from', async () => {
    let fileSystem = installFiles({
      [workflowPath]: [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - uses: actions/checkout@v3',
        '',
      ].join('\n'),
    })

    await applyUpdates([createUpdate({ action: { line: 5 } })])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3',
        '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
        '',
      ].join('\n'),
    )
  })

  it('writes the resolved tag rather than the latest SHA the update carries', async () => {
    let fileSystem = installFiles({
      [workflowPath]: workflowWithStep('      - uses: actions/checkout@v3'),
    })

    await applyUpdates([
      createUpdate({ targetRefStyle: 'tag', targetRef: 'v4.2.2' }),
    ])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      workflowWithStep('      - uses: actions/checkout@v4.2.2'),
    )
  })

  it('pins to the latest SHA when the update carries no resolved target', async () => {
    let fileSystem = installFiles({
      [workflowPath]: workflowWithStep('      - uses: actions/checkout@v3'),
    })

    await applyUpdates([
      createUpdate({ targetRefStyle: undefined, targetRef: undefined }),
    ])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      workflowWithStep(
        '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
      ),
    )
  })

  it.each([
    [
      'a note',
      '      - uses: actions/checkout@v3 # keep this',
      '      - uses: actions/checkout@v4.2.2 # keep this',
    ],
    [
      'a note that ends with an issue reference',
      '      - uses: actions/checkout@v3 # workaround for #123',
      '      - uses: actions/checkout@v4.2.2 # workaround for #123',
    ],
    [
      'a note that starts with a version',
      '      - uses: actions/checkout@v3 # v3 is the last release for node 16',
      '      - uses: actions/checkout@v4.2.2 # v3 is the last release for node 16',
    ],
    [
      'a word that starts with a digit',
      '      - uses: actions/checkout@v3 # 3rd-party',
      '      - uses: actions/checkout@v4.2.2 # 3rd-party',
    ],
  ])(
    'keeps %s after a tag target',
    async (_description, step, expectedStep) => {
      let fileSystem = installFiles({ [workflowPath]: workflowWithStep(step) })

      await applyUpdates([
        createUpdate({ targetRefStyle: 'tag', targetRef: 'v4.2.2' }),
      ])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        workflowWithStep(expectedStep),
      )
    },
  )

  it.each([
    '# v3.1.2',
    '#v3',
    '# 3.1.2',
    '# V3',
    '# v3.1.2-beta.1',
    '# v10.12.0',
  ])('drops the version comment %s after a tag target', async comment => {
    let fileSystem = installFiles({
      [workflowPath]: workflowWithStep(
        `      - uses: actions/checkout@v3 ${comment}`,
      ),
    })

    await applyUpdates([
      createUpdate({ targetRefStyle: 'tag', targetRef: 'v4.2.2' }),
    ])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      workflowWithStep('      - uses: actions/checkout@v4.2.2'),
    )
  })

  it.each([
    [
      'a tab',
      '      - uses: actions/checkout@v3\t# v3.1.2',
      '      - uses: actions/checkout@v4.2.2',
    ],
    [
      'several spaces',
      '      - uses: actions/checkout@v3   # v3.1.2',
      '      - uses: actions/checkout@v4.2.2',
    ],
    [
      'a quoted reference',
      "      - uses: 'actions/checkout@v3' # v3.1.2",
      "      - uses: 'actions/checkout@v4.2.2'",
    ],
    [
      'the closing brace of a flow mapping',
      '      - { uses: actions/checkout@v3 } # v3.1.2',
      '      - { uses: actions/checkout@v4.2.2 }',
    ],
  ])(
    'drops a version comment that follows %s without leaving trailing whitespace',
    async (_description, step, expectedStep) => {
      let fileSystem = installFiles({ [workflowPath]: workflowWithStep(step) })

      await applyUpdates([
        createUpdate({ targetRefStyle: 'tag', targetRef: 'v4.2.2' }),
      ])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        workflowWithStep(expectedStep),
      )
    },
  )

  it('drops a version comment without leaving whitespace before a CRLF line ending', async () => {
    let fileSystem = installFiles({
      [workflowPath]: [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v3 # v3.1.2',
        '      - run: npm test',
        '',
      ].join('\r\n'),
    })

    await applyUpdates([
      createUpdate({ targetRefStyle: 'tag', targetRef: 'v4.2.2' }),
    ])

    expect(fileSystem.contentOf(workflowPath)).toBe(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v4.2.2',
        '      - run: npm test',
        '',
      ].join('\r\n'),
    )
  })

  it.each<[string, UpdateOverrides]>([
    [
      'there is neither a target ref nor a SHA',
      { targetRefStyle: null, latestSha: null, targetRef: null },
    ],
    [
      'the update was skipped although its SHA is known',
      {
        skipReason: 'unsupported-style',
        targetRefStyle: null,
        status: 'skipped',
        hasUpdate: false,
        targetRef: null,
      },
    ],
    [
      'the recorded line is past the end of the file',
      { action: { line: lineAfterStepWorkflow } },
    ],
  ])('leaves the file unchanged when %s', async (_description, overrides) => {
    let original = workflowWithStep('      - uses: actions/checkout@v3')
    let fileSystem = installFiles({ [workflowPath]: original })

    await applyUpdates([createUpdate(overrides)])

    expect(fileSystem.contentOf(workflowPath)).toBe(original)
  })

  it.each<[string, UpdateOverrides, string]>([
    [
      'an action name with a line break',
      { action: { name: 'actions/checkout\nmalformed' } },
      'Invalid action name: actions/checkout\nmalformed',
    ],
    [
      'a current version with a line break',
      { currentVersion: 'v3\n' },
      'Invalid version: v3\n',
    ],
    [
      'a target ref with a line break',
      { targetRefStyle: 'tag', targetRef: 'v4.2.2\n' },
      'Invalid target ref: v4.2.2\n',
    ],
    [
      'a blank target ref',
      { targetRefStyle: 'tag', targetRef: '  ' },
      'Invalid target ref:   ',
    ],
    [
      'a SHA target that is not hexadecimal',
      { targetRef: 'not-a-sha' },
      'Invalid SHA format: not-a-sha',
    ],
    [
      'a SHA target one character too long',
      { targetRef: '11bd71901bbe5b1630ceea73d27597364c9af6830' },
      'Invalid SHA format: 11bd71901bbe5b1630ceea73d27597364c9af6830',
    ],
  ])(
    'leaves the file unchanged and reports %s',
    async (_description, overrides, expectedMessage) => {
      let original = workflowWithStep('      - uses: actions/checkout@v3')
      let fileSystem = installFiles({ [workflowPath]: original })
      let consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      await applyUpdates([createUpdate(overrides)])

      expect(fileSystem.contentOf(workflowPath)).toBe(original)
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(expectedMessage)
    },
  )

  it('writes no file for an update that records no file', async () => {
    installFiles({
      [workflowPath]: workflowWithStep('      - uses: actions/checkout@v3'),
    })

    await applyUpdates([createUpdate({ action: { file: undefined } })])

    expect(writeFile).not.toHaveBeenCalled()
  })

  describe('without a usable line', () => {
    it.each([
      ['missing', undefined],
      ['recorded as unknown', 0],
    ])(
      'rewrites every reference to the current version when the line is %s',
      async (_description, line) => {
        let fileSystem = installFiles({
          [workflowPath]: [
            'jobs:',
            '  build:',
            '    steps:',
            '      - uses: actions/checkout@v3',
            '  test:',
            '    steps:',
            '      - uses: actions/checkout@v3',
            '',
          ].join('\n'),
        })

        await applyUpdates([createUpdate({ action: { line } })])

        expect(fileSystem.contentOf(workflowPath)).toBe(
          [
            'jobs:',
            '  build:',
            '    steps:',
            '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
            '  test:',
            '    steps:',
            '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
            '',
          ].join('\n'),
        )
      },
    )

    it('leaves a longer version that starts with the current one untouched', async () => {
      let fileSystem = installFiles({
        [workflowPath]: [
          'jobs:',
          '  build:',
          '    steps:',
          '      - uses: actions/checkout@v3',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v3.0.2',
          '',
        ].join('\n'),
      })

      await applyUpdates([createUpdate({ action: { line: undefined } })])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        [
          'jobs:',
          '  build:',
          '    steps:',
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v3.0.2',
          '',
        ].join('\n'),
      )
    })

    it('leaves a commented-out step untouched', async () => {
      let fileSystem = installFiles({
        [workflowPath]: [
          'jobs:',
          '  build:',
          '    steps:',
          '      # - uses: actions/checkout@v3',
          '      - uses: actions/checkout@v3',
          '',
        ].join('\n'),
      })

      await applyUpdates([createUpdate({ action: { line: undefined } })])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        [
          'jobs:',
          '  build:',
          '    steps:',
          '      # - uses: actions/checkout@v3',
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
          '',
        ].join('\n'),
      )
    })

    it('pins a version and a longer version that starts with it, one update each', async () => {
      let fileSystem = installFiles({
        [workflowPath]: [
          'jobs:',
          '  build:',
          '    steps:',
          '      - uses: actions/checkout@v3',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@v3.0.2',
          '',
        ].join('\n'),
      })

      await applyUpdates([
        createUpdate({ action: { line: undefined } }),
        createUpdate({
          action: { version: 'v3.0.2', line: undefined },
          currentVersion: 'v3.0.2',
        }),
      ])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        [
          'jobs:',
          '  build:',
          '    steps:',
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
          '  test:',
          '    steps:',
          '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2',
          '',
        ].join('\n'),
      )
    })

    it('adds no version comment when the update has no line and more of the step follows', async () => {
      let fileSystem = installFiles({
        [workflowPath]: [
          'steps:',
          '  - { uses: actions/checkout@v3, name: Checkout }',
          '',
        ].join('\n'),
      })

      await applyUpdates([createUpdate({ action: { line: undefined } })])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        [
          'steps:',
          '  - { uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683, name: Checkout }',
          '',
        ].join('\n'),
      )
    })
  })

  describe('runs-on', () => {
    /**
     * Line on which `workflowWithRunner` puts the runner label, and the line
     * `createRunnerUpdate` records as the one the label was scanned from.
     */
    let runnerLine = 3

    /**
     * First line number past the end of a file built by `workflowWithRunner`.
     */
    let lineAfterRunnerWorkflow = 5

    /**
     * Build a runner update the way the CLI derives it from the runner table:
     * the `ubuntu-22.04` label of the `build` job scanned on `runnerLine`.
     *
     * @param overrides - Fields to change.
     * @returns Update entry.
     */
    function createRunnerUpdate(overrides: UpdateOverrides = {}): ActionUpdate {
      let { action, ...update } = overrides
      return {
        currentVersion: 'ubuntu-22.04',
        latestVersion: 'ubuntu-24.04',
        targetRef: 'ubuntu-24.04',
        targetRefStyle: 'tag',
        publishedAt: null,
        isBreaking: true,
        latestSha: null,
        hasUpdate: true,
        status: 'ok',
        ...update,
        action: {
          version: 'ubuntu-22.04',
          name: 'runner/ubuntu',
          file: workflowPath,
          line: runnerLine,
          type: 'runner',
          job: 'build',
          ...action,
        },
      }
    }

    /**
     * Build a workflow whose `build` job declares its runner on `runnerLine`.
     *
     * @param runner - Line holding the runner label.
     * @returns Workflow YAML text.
     */
    function workflowWithRunner(runner: string): string {
      return ['jobs:', '  build:', runner, ''].join('\n')
    }

    it.each([
      [
        'an unquoted label',
        '    runs-on: ubuntu-22.04',
        '    runs-on: ubuntu-24.04',
      ],
      [
        'a single-quoted label',
        "    runs-on: 'ubuntu-22.04'",
        "    runs-on: 'ubuntu-24.04'",
      ],
      [
        'a double-quoted label',
        '    runs-on: "ubuntu-22.04"',
        '    runs-on: "ubuntu-24.04"',
      ],
      [
        'a label under a quoted key',
        '    "runs-on": ubuntu-22.04',
        '    "runs-on": ubuntu-24.04',
      ],
      [
        'a label followed by a comment',
        '    runs-on: ubuntu-22.04 # pinned on purpose',
        '    runs-on: ubuntu-24.04 # pinned on purpose',
      ],
    ])('replaces %s', async (_description, runner, expectedRunner) => {
      let fileSystem = installFiles({
        [workflowPath]: workflowWithRunner(runner),
      })

      await applyUpdates([createRunnerUpdate()])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        workflowWithRunner(expectedRunner),
      )
    })

    it('replaces a label whose version has no minor part', async () => {
      let fileSystem = installFiles({
        [workflowPath]: workflowWithRunner('    runs-on: windows-2022'),
      })

      await applyUpdates([
        createRunnerUpdate({
          action: { version: 'windows-2022', name: 'runner/windows' },
          currentVersion: 'windows-2022',
          latestVersion: 'windows-2025',
          targetRef: 'windows-2025',
        }),
      ])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        workflowWithRunner('    runs-on: windows-2025'),
      )
    })

    it.each([
      [
        'without a comment',
        '    runs-on: ubuntu-22.04',
        '    runs-on: ubuntu-24.04',
      ],
      [
        'with a comment',
        '    runs-on: ubuntu-22.04 # pinned',
        '    runs-on: ubuntu-24.04 # pinned',
      ],
      [
        'with a quoted label',
        '    runs-on: "ubuntu-22.04"  # pinned',
        '    runs-on: "ubuntu-24.04"  # pinned',
      ],
    ])(
      'rewrites a CRLF line %s',
      async (_description, runner, expectedRunner) => {
        let fileSystem = installFiles({
          [workflowPath]: ['jobs:', '  build:', runner, ''].join('\r\n'),
        })

        await applyUpdates([createRunnerUpdate()])

        expect(fileSystem.contentOf(workflowPath)).toBe(
          ['jobs:', '  build:', expectedRunner, ''].join('\r\n'),
        )
      },
    )

    it('rewrites only the scanned line when two jobs share a label', async () => {
      let fileSystem = installFiles({
        [workflowPath]: [
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-22.04',
          '  test:',
          '    runs-on: ubuntu-22.04',
          '',
        ].join('\n'),
      })

      await applyUpdates([createRunnerUpdate()])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        [
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-24.04',
          '  test:',
          '    runs-on: ubuntu-22.04',
          '',
        ].join('\n'),
      )
    })

    it.each<[string, string, UpdateOverrides]>([
      ['the line names another label', '    runs-on: ubuntu-24.04', {}],
      ['the label sits in a flow mapping', '    { runs-on: ubuntu-22.04 }', {}],
      [
        'the update has no target label',
        '    runs-on: ubuntu-22.04',
        { targetRef: null },
      ],
      [
        'the update has no current label',
        '    runs-on: ubuntu-22.04',
        { currentVersion: null },
      ],
      [
        'the update records no line',
        '    runs-on: ubuntu-22.04',
        { action: { line: undefined } },
      ],
      [
        'the update records the unknown line',
        '    runs-on: ubuntu-22.04',
        { action: { line: 0 } },
      ],
      [
        'the recorded line is past the end of the file',
        '    runs-on: ubuntu-22.04',
        { action: { line: lineAfterRunnerWorkflow } },
      ],
      [
        'the update was skipped',
        '    runs-on: ubuntu-22.04',
        { status: 'skipped' },
      ],
    ])(
      'leaves the file unchanged when %s',
      async (_description, runner, overrides) => {
        let original = workflowWithRunner(runner)
        let fileSystem = installFiles({ [workflowPath]: original })

        await applyUpdates([createRunnerUpdate(overrides)])

        expect(fileSystem.contentOf(workflowPath)).toBe(original)
      },
    )

    it.each([
      [
        'a label followed by an injected line',
        'ubuntu-24.04\nmalicious: true',
        'Invalid runner label: ubuntu-24.04\nmalicious: true',
      ],
      [
        'a label preceded by an injected line',
        'malicious: true\nubuntu-24.04',
        'Invalid runner label: malicious: true\nubuntu-24.04',
      ],
    ])(
      'refuses to write %s',
      async (_description, targetLabel, expectedMessage) => {
        let original = workflowWithRunner('    runs-on: ubuntu-22.04')
        let fileSystem = installFiles({ [workflowPath]: original })
        let consoleError = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {})

        await applyUpdates([createRunnerUpdate({ targetRef: targetLabel })])

        expect(fileSystem.contentOf(workflowPath)).toBe(original)
        expect(consoleError).toHaveBeenCalledExactlyOnceWith(expectedMessage)
      },
    )
  })

  describe('current behavior pending owner decision', () => {
    it('writes one version comment, for the last action only, after a flow-style line holding two updated actions', async () => {
      let fileSystem = installFiles({
        [workflowPath]:
          "steps: [ { 'uses': 'actions/checkout@v3' }, { 'uses': 'actions/setup-node@v3' } ]\n",
      })

      await applyUpdates([
        createUpdate({ action: { line: 1 } }),
        createSetupNodeUpdate(1),
      ])

      expect(fileSystem.contentOf(workflowPath)).toBe(
        "steps: [ { 'uses': 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683' }, { 'uses': 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020' } ] # v4.4.0\n",
      )
    })

    it('glues the original version to the comment when the current version is unknown', async () => {
      let filePath = '/repo/.github/workflows/missing-version.yml'
      let fileSystem = installFiles({
        [filePath]: 'steps:\n  - uses: actions/cache@v3\n',
      })

      await applyUpdates([
        createUpdate({
          action: {
            name: 'actions/cache',
            line: undefined,
            file: filePath,
            version: null,
          },
          latestSha: '1234567890abcdef1234567890abcdef12345678',
          targetRefStyle: undefined,
          latestVersion: 'v3.1.5',
          targetRef: undefined,
          currentVersion: null,
        }),
      ])

      expect(fileSystem.contentOf(filePath)).toBe(
        'steps:\n  - uses: actions/cache@1234567890abcdef1234567890abcdef12345678 # v3.1.5v3\n',
      )
    })
  })
})
