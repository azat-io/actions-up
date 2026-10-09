import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { MultiselectEntry } from '../../../types/multiselect-entry'
import type { GitHubAction } from '../../../types/github-action'
import type { ActionUpdate } from '../../../types/action-update'

import { promptUpdateSelection } from '../../../core/interactive/prompt-update-selection'
import { runMultiselect } from '../../../core/interactive/multiselect/run-multiselect'
import { createFakeTerminal } from '../../helpers/create-fake-terminal'
import { stripAnsi } from '../../../core/interactive/strip-ansi'
import { colors } from '../../../core/interactive/colors'

/**
 * The colors module decides at import time whether to color, from the
 * environment and the terminal. Colors turned on render every row the same way
 * everywhere, and make the column widths account for color codes the way they
 * must in a terminal.
 */
vi.mock(import('../../../core/interactive/colors'), async importOriginal => {
  let actual = await importOriginal()
  return { ...actual, colors: actual.createColors(true) }
})

/**
 * The prompt answers through a stand-in in most tests, which checks the lines
 * the selection lists and chooses some of them. The tests in a terminal reset
 * the spy to run the real prompt.
 */
vi.mock(import('../../../core/interactive/multiselect/run-multiselect'), {
  spy: true,
})

/**
 * SHA of the latest release, the target of SHA-pinned updates.
 */
const TARGET_SHA = '0400d5f644dc74513175e3cd8d07132dd4860809'

/**
 * SHA an action is currently pinned to.
 */
const CURRENT_SHA = '11bd71901bbe5b1630ceea73d27597364c9af683'

/**
 * Workflow that holds no update unless a test puts one there.
 */
const LINT_WORKFLOW = '/repo/.github/workflows/lint.yml'

/**
 * Moment the release ages are measured from.
 */
const NOW = new Date('2026-01-15T10:00:00Z')

/**
 * One hour in milliseconds.
 */
const HOUR = 60 * 60 * 1000

/**
 * Stand-in for the multiselect prompt.
 */
interface FakeMultiselect {
  /**
   * Answer the prompt: the values of the lines the user chose, or of the rows
   * selected at the start when the user presses Enter right away.
   */
  answer(options: SelectionOptions): Promise<number[] | null>

  /**
   * Choose the lines that are selected when the user presses Enter: group
   * labels by their file and rows by their action. Without a choice the user
   * presses Enter right away, on the rows the prompt selected at the start.
   */
  select(...texts: string[]): void

  /**
   * Make the prompt reject instead of answering.
   */
  failWith(error: Error): void

  /**
   * Options of the shown prompt; throws when the prompt was not shown.
   */
  shown(): SelectionOptions

  /**
   * Summary the prompt prints after the question once the user presses Enter;
   * throws when the prompt was not submitted.
   */
  summary(): string
}

/**
 * Fields of an update to replace; `action` fields are merged into the default
 * action.
 */
type UpdateOverrides = Partial<Omit<ActionUpdate, 'action'>> & {
  action?: Partial<GitHubAction>
}

/**
 * What the selection shows in the multiselect prompt.
 */
type SelectionOptions = Parameters<typeof runMultiselect<number>>[0]

/**
 * Column titles of the table.
 */
type ColumnTitle = 'Current' | 'Action' | 'Target' | 'Job' | 'Age'

let prompt = createFakeMultiselect()

/**
 * Create the multiselect stand-in.
 *
 * Like the real prompt, it selects the rows marked as selected at the start,
 * unless they are disabled; choosing a group label selects every row of its
 * group that is not disabled; a disabled row cannot be chosen. On Enter it
 * answers with the values of the selected rows, in the order of the list, and
 * renders the summary through the `summarize` option.
 *
 * @returns Fake whose `answer` stands in for `runMultiselect`.
 */
function createFakeMultiselect(): FakeMultiselect {
  let shownOptions: SelectionOptions | null = null
  let selectedTexts: string[] | null = null
  let summary: string | null = null
  let failure: Error | null = null

  /**
   * Options of the shown prompt.
   *
   * @returns Options passed to the last prompt call.
   */
  function shown(): SelectionOptions {
    if (!shownOptions) {
      throw new Error('The selection prompt was not shown')
    }
    return shownOptions
  }

  return {
    answer(options) {
      shownOptions = options
      if (failure) {
        return Promise.reject(failure)
      }
      let values =
        selectedTexts ?
          selectListed(options.entries, selectedTexts)
        : options.entries.flatMap(entry =>
            entry.kind === 'option' && entry.selected && !entry.disabled ?
              [entry.value]
            : [],
          )
      summary = options.summarize(values)
      return Promise.resolve(values)
    },
    summary() {
      if (summary === null) {
        throw new Error('The selection prompt was not submitted')
      }
      return summary
    },
    select(...texts) {
      selectedTexts = texts
    },
    failWith(error) {
      failure = error
    },
    shown,
  }
}

/**
 * Values the user selects by choosing listed lines, in the order of the list.
 *
 * @param entries - Lines the prompt was shown with.
 * @param texts - Files of group labels and actions of rows.
 * @returns Values of the selected rows.
 */
function selectListed(
  entries: MultiselectEntry<number>[],
  texts: string[],
): number[] {
  let chosen = new Set<number>()
  for (let text of texts) {
    let position = findListed(entries, text)
    let entry = entries[position]!
    if (entry.kind === 'option' && entry.disabled) {
      throw new Error(`A disabled row cannot be selected: ${entry.message}`)
    }
    let positions =
      entry.kind === 'group' ? linesOfGroup(entries, position) : [position]
    for (let line of positions) {
      let lineEntry = entries[line]!
      if (lineEntry.kind === 'option' && !lineEntry.disabled) {
        chosen.add(line)
      }
    }
  }
  return entries.flatMap((entry, position) =>
    entry.kind === 'option' && chosen.has(position) ? [entry.value] : [],
  )
}

/**
 * Build an outdated update of `actions/cache` used by the `build` job of the CI
 * workflow: pinned to a tag and resolved, the way the CLI resolves updates
 * before the prompt, to the SHA of a newer minor release.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh update.
 */
function makeUpdate({
  action,
  ...overrides
}: UpdateOverrides = {}): ActionUpdate {
  return {
    currentVersion: 'v4.1.0',
    latestVersion: 'v4.2.0',
    targetRefStyle: 'sha',
    latestSha: TARGET_SHA,
    targetRef: TARGET_SHA,
    isBreaking: false,
    publishedAt: null,
    hasUpdate: true,
    ...overrides,
    action: {
      file: '/repo/.github/workflows/ci.yml',
      name: 'actions/cache',
      version: 'v4.1.0',
      type: 'external',
      job: 'build',
      ...action,
    },
  }
}

/**
 * Text of one cell of an update's row, read under its column title the way a
 * person reads the table.
 *
 * @param action - Action shown in the row.
 * @param title - Title of the column.
 * @returns Visible cell text without padding.
 */
function cellOf(action: string, title: ColumnTitle): string {
  let header = headerOf(action)
  let titles = header.split(/ {2,}/u)
  if (!titles.includes(title)) {
    throw new Error(`The table has no ${title} column`)
  }
  let text = stripAnsi(rowOf(action).message)
  let nextTitle = titles[titles.indexOf(title) + 1]
  let end = nextTitle === undefined ? text.length : header.indexOf(nextTitle)
  return text.slice(header.indexOf(title), end).trim()
}

/**
 * Positions of the lines of a group under its label: the column header and the
 * rows, up to the blank line or the next label.
 *
 * @param entries - Lines the prompt was shown with.
 * @param label - Position of the group label.
 * @returns Positions of the lines.
 */
function linesOfGroup(
  entries: MultiselectEntry<number>[],
  label: number,
): number[] {
  let positions: number[] = []
  for (let line = label + 1; line < entries.length; line++) {
    let entry = entries[line]!
    if (entry.kind === 'group' || entry.message === ' ') {
      break
    }
    positions.push(line)
  }
  return positions
}

/**
 * Position of the group label or the row whose first cell shows the given text.
 *
 * @param entries - Lines the prompt was shown with.
 * @param text - File of a group label or action of a row.
 * @returns Position of the line.
 */
function findListed(entries: MultiselectEntry<number>[], text: string): number {
  let position = entries.findIndex(
    entry => entry.kind !== 'separator' && firstCellOf(entry.message) === text,
  )
  if (position === -1) {
    throw new Error(`Nothing is listed as ${text}`)
  }
  return position
}

/**
 * Column header of the group that lists an action, without its leading mark.
 *
 * @param action - Action shown in a row of the group.
 * @returns Visible header text.
 */
function headerOf(action: string): string {
  let { entries } = prompt.shown()
  let row = findListed(entries, action)
  let label = entries.findLastIndex(
    (entry, position) => position < row && entry.kind === 'group',
  )
  return stripAnsi(entries[label + 1]!.message).replace(/^ ○ /u, '')
}

/**
 * Row of the update of an action in the shown prompt.
 *
 * @param action - Action shown in the row.
 * @returns Line whose first cell is the action.
 */
function rowOf(action: string): MultiselectEntry<number> {
  let { entries } = prompt.shown()
  let row = entries[findListed(entries, action)]!
  if (row.kind !== 'option') {
    throw new Error(`${action} is a group label, not a row`)
  }
  return row
}

/**
 * Build an outdated update for which no target reference was resolved, so there
 * is nothing to write back.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh update without a target.
 */
function makeUpdateWithoutTarget(
  overrides: UpdateOverrides = {},
): ActionUpdate {
  return makeUpdate({
    targetRefStyle: null,
    latestSha: null,
    targetRef: null,
    ...overrides,
  })
}

/**
 * Lines of the group of a file in the shown prompt.
 *
 * @param file - File shown in the group label.
 * @returns Column header and rows of the group.
 */
function groupLines(file: string): MultiselectEntry<number>[] {
  let { entries } = prompt.shown()
  return linesOfGroup(entries, findListed(entries, file)).map(
    line => entries[line]!,
  )
}

/**
 * Visible text of the group labels, top to bottom.
 *
 * @returns Files shown in the group labels.
 */
function groupLabels(): string[] {
  return prompt
    .shown()
    .entries.filter(entry => entry.kind === 'group')
    .map(entry => stripAnsi(entry.message))
}

/**
 * Column titles of the group of a file, left to right.
 *
 * @param file - File shown in the group label.
 * @returns Titles in the column header.
 */
function columnTitlesOf(file: string): string[] {
  let [header] = groupLines(file)
  return stripAnsi(header!.message).replace(/^ ○ /u, '').split(/ {2,}/u)
}

/**
 * Visible text of every listed line, top to bottom.
 *
 * @returns Group labels, column headers, rows and blank lines.
 */
function listedLines(): string[] {
  return prompt.shown().entries.map(entry => stripAnsi(entry.message))
}

/**
 * Visible first cell of a line: the file of a group label, the action of a row,
 * the first title of a column header.
 *
 * @param message - Message of the line.
 * @returns Text up to the first gap of two or more spaces.
 */
function firstCellOf(message: string): string {
  return stripAnsi(message).split(/ {2,}/u, 1)[0] ?? ''
}

/**
 * Moment a number of hours before `NOW`.
 *
 * @param hours - Hours to go back.
 * @returns Date of that moment.
 */
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR)
}

/**
 * Moment a number of days before `NOW`.
 *
 * @param days - Days to go back.
 * @returns Date of that moment.
 */
function daysAgo(days: number): Date {
  return hoursAgo(days * 24)
}

describe('promptUpdateSelection', () => {
  let info: MockInstance<typeof console.info>
  let error: MockInstance<typeof console.error>
  let warn: MockInstance<typeof console.warn>

  beforeEach(() => {
    prompt = createFakeMultiselect()
    vi.mocked(runMultiselect).mockImplementation(options =>
      prompt.answer(options as SelectionOptions),
    )
    vi.spyOn(process, 'cwd').mockReturnValue('/repo')
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders colors in this file whatever the environment says, so color assertions are meaningful', () => {
    expect(colors.gray('x')).not.toBe('x')
  })

  it('returns null silently, without showing the prompt, when there are no updates', async () => {
    let result = await promptUpdateSelection([])

    expect(result).toBeNull()
    expect(info).not.toHaveBeenCalled()
    expect(runMultiselect).not.toHaveBeenCalled()
  })

  it('reports that every action is up to date, without showing the prompt, when nothing is outdated', async () => {
    let result = await promptUpdateSelection([makeUpdate({ hasUpdate: false })])

    expect(result).toBeNull()
    expect(info).toHaveBeenCalledExactlyOnceWith(
      colors.green('✓ All actions are up to date!'),
    )
    expect(runMultiselect).not.toHaveBeenCalled()
  })

  it('shows a multiselect prompt that explains its keys', async () => {
    await promptUpdateSelection([makeUpdate()])

    expect(prompt.shown()).toMatchObject({
      message: `Choose which actions to update (Press ${colors.cyan('<space>')} to select, ${colors.cyan('<a>')} to toggle all, ${colors.cyan('<i>')} to invert selection)`,
      footer: 'Enter to start updating. Ctrl-c to cancel.',
    })
  })

  it('logs and rethrows an unexpected failure of the prompt', async () => {
    let failure = new Error('terminal closed')
    prompt.failWith(failure)

    await expect(promptUpdateSelection([makeUpdate()])).rejects.toBe(failure)

    expect(error).toHaveBeenCalledExactlyOnceWith(
      colors.red('Unexpected error during selection:'),
      failure,
    )
  })

  describe('selection', () => {
    it('returns every update with a target in a group when the user selects its file', async () => {
      let cache = makeUpdate()
      let checkout = makeUpdate({
        action: { name: 'actions/checkout' },
        latestVersion: 'v5.0.0',
        isBreaking: true,
      })
      let setupNode = makeUpdateWithoutTarget({
        action: { name: 'actions/setup-node' },
      })
      let setupPython = makeUpdate({
        action: { name: 'actions/setup-python', file: LINT_WORKFLOW },
      })
      prompt.select('workflows/ci.yml')

      let result = await promptUpdateSelection([
        cache,
        checkout,
        setupNode,
        setupPython,
      ])

      expect(result).toStrictEqual([cache, checkout])
    })

    it('returns only the updates whose rows the user selects', async () => {
      let cache = makeUpdate()
      let checkout = makeUpdate({ action: { name: 'actions/checkout' } })
      prompt.select('actions/checkout')

      let result = await promptUpdateSelection([cache, checkout])

      expect(result).toStrictEqual([checkout])
    })

    it('lets the user select a tag target that has no SHA', async () => {
      let update = makeUpdate({
        latestVersion: 'v5.1.0',
        targetRefStyle: 'tag',
        currentVersion: 'v4',
        latestSha: null,
        targetRef: 'v5',
      })
      prompt.select('actions/cache')

      let result = await promptUpdateSelection([update])

      expect(result).toStrictEqual([update])
    })

    it('returns null and says so when the user submits with nothing selected', async () => {
      prompt.select()

      let result = await promptUpdateSelection([makeUpdate()])

      expect(result).toBeNull()
      expect(info).toHaveBeenCalledExactlyOnceWith(
        colors.yellow('\nNo actions selected'),
      )
    })

    it('returns null when the user selects a group in which no update has a target', async () => {
      prompt.select('workflows/lint.yml')

      let result = await promptUpdateSelection([
        makeUpdate(),
        makeUpdateWithoutTarget({
          action: { name: 'actions/setup-node', file: LINT_WORKFLOW },
        }),
      ])

      expect(result).toBeNull()
    })

    it.each([
      {
        selection: ['actions/cache'],
        summary: '1 action selected',
        description: 'a single row',
      },
      {
        description: 'a group, counting only its updates with a target',
        selection: ['workflows/ci.yml'],
        summary: '2 actions selected',
      },
      {
        description: 'a group and one of its rows, counting each update once',
        selection: ['actions/cache', 'workflows/ci.yml'],
        summary: '2 actions selected',
      },
      {
        description: 'a group in which no update has a target',
        selection: ['workflows/lint.yml'],
        summary: '',
      },
    ])(
      'prints the summary "$summary" after the user selects $description',
      async ({ selection, summary }) => {
        prompt.select(...selection)

        await promptUpdateSelection([
          makeUpdate(),
          makeUpdate({
            action: { name: 'actions/checkout' },
            latestVersion: 'v5.0.0',
            isBreaking: true,
          }),
          makeUpdateWithoutTarget({ action: { name: 'actions/setup-node' } }),
          makeUpdateWithoutTarget({
            action: { name: 'actions/setup-python', file: LINT_WORKFLOW },
          }),
        ])

        expect(prompt.summary()).toBe(summary)
      },
    )

    it('lists an update without a target as a row that cannot be selected', async () => {
      await promptUpdateSelection([
        makeUpdate(),
        makeUpdateWithoutTarget({ action: { name: 'actions/setup-node' } }),
      ])

      expect(groupLines('workflows/ci.yml')).toMatchObject([
        { kind: 'separator' },
        { disabled: false },
        { disabled: true },
      ])
    })
  })

  describe('in a terminal', () => {
    beforeEach(() => {
      vi.mocked(runMultiselect).mockReset()
    })

    it('submits the updates that have a target and are not breaking when the user presses Enter right away', async () => {
      let terminal = createFakeTerminal({ columns: 120, rows: 40 })
      let cache = makeUpdate()
      let checkout = makeUpdate({
        action: { name: 'actions/checkout' },
        latestVersion: 'v5.0.0',
        isBreaking: true,
      })
      let setupNode = makeUpdateWithoutTarget({
        action: { name: 'actions/setup-node' },
      })

      let selection = promptUpdateSelection([checkout, cache, setupNode])
      await terminal.settle()
      await terminal.press('\r')

      await expect(selection).resolves.toStrictEqual([cache])
    })

    it.each([
      { name: 'Ctrl-C', key: '\u{3}' },
      { key: '\u{1B}', name: 'Esc' },
    ])(
      'closes the prompt and returns null when the user cancels with $name',
      async ({ key }) => {
        let terminal = createFakeTerminal({ columns: 120, rows: 40 })

        let selection = promptUpdateSelection([makeUpdate()])
        await terminal.settle()
        await terminal.press(key)

        await expect(selection).resolves.toBeNull()
        expect(console.info).toHaveBeenCalledWith(
          `\r\u{1B}[K${colors.yellow('Selection cancelled')}`,
        )
      },
    )
  })

  describe('list', () => {
    it('lists one group per file sorted by path, its rows in input order, and a blank line between groups', async () => {
      await promptUpdateSelection([
        makeUpdate({
          action: { name: 'actions/setup-python', file: LINT_WORKFLOW },
        }),
        makeUpdate({ action: { name: 'actions/checkout' } }),
        makeUpdate(),
      ])

      expect(listedLines().map(firstCellOf)).toStrictEqual([
        'workflows/ci.yml',
        ' ○ Action',
        'actions/checkout',
        'actions/cache',
        ' ',
        'workflows/lint.yml',
        ' ○ Action',
        'actions/setup-python',
      ])
    })

    it('lists the column headers and the blank lines as lines that cannot be selected', async () => {
      await promptUpdateSelection([
        makeUpdate(),
        makeUpdate({ action: { file: LINT_WORKFLOW } }),
      ])

      expect(prompt.shown().entries).toMatchObject([
        { kind: 'group' },
        { kind: 'separator' },
        { kind: 'option' },
        { kind: 'separator', message: ' ' },
        { kind: 'group' },
        { kind: 'separator' },
        { kind: 'option' },
      ])
    })

    it('labels a group with the original path when the file is the .github directory itself', async () => {
      await promptUpdateSelection([
        makeUpdate({ action: { file: '/repo/.github' } }),
      ])

      expect(groupLabels()).toStrictEqual(['/repo/.github'])
    })

    it('lets the user select an update whose file is unknown', async () => {
      let update = makeUpdate({ action: { file: undefined } })
      prompt.select('actions/cache')

      let result = await promptUpdateSelection([update])

      expect(result).toStrictEqual([update])
    })

    it('widens the Action column to fit the longest action name', async () => {
      let longName = 'my-organization/monorepo-tooling/actions/setup-workspace'

      await promptUpdateSelection([
        makeUpdate({ action: { name: longName } }),
        makeUpdate(),
      ])

      expect(cellOf(longName, 'Action')).toBe(longName)
    })

    it('widens the Job column to fit the longest job name', async () => {
      await promptUpdateSelection([
        makeUpdate({ action: { job: 'integration-tests' } }),
        makeUpdate({ action: { name: 'actions/checkout' } }),
      ])

      expect(cellOf('actions/cache', 'Job')).toBe('integration-tests')
    })

    it('widens the Current column to fit the longest current version', async () => {
      await promptUpdateSelection([
        makeUpdate({ currentVersion: 'actions-v1.2.3-beta.1' }),
        makeUpdate({ action: { name: 'actions/checkout' } }),
      ])

      expect(cellOf('actions/cache', 'Current')).toBe('actions-v1.2.3-beta.1')
    })

    it.each([
      {
        other: makeUpdateWithoutTarget({ latestVersion: null }),
        description: 'ignoring an unknown target',
        expected: '4.2.0 (0400d5f)',
      },
      {
        other: makeUpdate({
          latestVersion: 'v5.10.0',
          targetRefStyle: 'tag',
          currentVersion: 'v4',
          targetRef: 'v5',
        }),
        description: 'ignoring the latest version behind a tag target',
        expected: '4.2.0 (0400d5f)',
      },
      {
        other: makeUpdateWithoutTarget({
          action: { comment: ' v4.10.1' },
          currentVersion: CURRENT_SHA,
          latestVersion: null,
        }),
        description: 'including a version recorded in a comment',
        expected: '4.2.0  (0400d5f)',
      },
    ])(
      'pads the version of a SHA target to the longest version shown, $description',
      async ({ expected, other }) => {
        await promptUpdateSelection([
          other,
          makeUpdate({ action: { name: 'actions/checkout' } }),
        ])

        expect(cellOf('actions/checkout', 'Target')).toBe(expected)
      },
    )

    it('aligns every arrow when a SHA pinned with a version comment follows a longer version', async () => {
      await promptUpdateSelection([
        makeUpdate({
          action: { name: 'actions/checkout' },
          latestVersion: 'v4.10.10',
        }),
        makeUpdate({
          action: { comment: ' v4.1.0' },
          currentVersion: CURRENT_SHA,
        }),
      ])

      expect(listedLines()).toStrictEqual([
        'workflows/ci.yml',
        ' ○ Action                                    Job    Current            ❯  Target',
        'actions/checkout                          build  4.1.0              ❯  4.10.10 (0400d5f)',
        'actions/cache                             build  4.1.0   (11bd719)  ❯  4.2.0   (0400d5f)',
      ])
    })

    it('shows a dash in Job for an action used outside a job', async () => {
      await promptUpdateSelection([makeUpdate({ action: { job: undefined } })])

      expect(cellOf('actions/cache', 'Job')).toBe('–')
    })

    it.each([
      {
        description: 'a tag without its v prefix',
        currentVersion: 'v4.1.0',
        expected: '4.1.0',
      },
      {
        description: 'a prefixed tag unchanged',
        currentVersion: 'actions-v1.2.3',
        expected: 'actions-v1.2.3',
      },
      {
        description: 'a SHA without a comment as its short form',
        currentVersion: CURRENT_SHA,
        expected: '11bd719',
      },
      {
        description: 'a SHA whose comment is not a version as its short form',
        currentVersion: CURRENT_SHA,
        expected: '11bd719',
        comment: ' pinned',
      },
      {
        description: 'a SHA as the version from its comment and its short form',
        expected: '4.1.0 (11bd719)',
        currentVersion: CURRENT_SHA,
        comment: ' v4.1.0',
      },
      {
        description: 'a tag next to a version comment as the tag alone',
        currentVersion: 'v4',
        comment: ' v4.1.0',
        expected: '4',
      },
      {
        description: 'a missing version as unknown',
        currentVersion: null,
        expected: 'unknown',
      },
    ])(
      'shows $description in Current',
      async ({ currentVersion, expected, comment }) => {
        await promptUpdateSelection([
          makeUpdate({ action: { comment }, currentVersion }),
        ])

        expect(cellOf('actions/cache', 'Current')).toBe(expected)
      },
    )

    it.each([
      {
        description: 'the latest version and the short SHA of a SHA target',
        expected: '4.2.0 (0400d5f)',
        update: makeUpdate(),
      },
      {
        description:
          'the latest version and the short latest SHA of an update whose target reference was never resolved',
        update: makeUpdate({ targetRefStyle: undefined, targetRef: undefined }),
        expected: '4.2.0 (0400d5f)',
      },
      {
        update: makeUpdate({
          latestVersion: 'v5.1.0',
          targetRefStyle: 'tag',
          currentVersion: 'v4',
          targetRef: 'v5',
        }),
        description: 'the tag of a tag target, without a SHA',
        expected: 'v5',
      },
      {
        update: makeUpdateWithoutTarget({ latestVersion: null }),
        description: 'unknown when there is no latest version',
        expected: 'unknown',
      },
    ])('shows $description in Target', async ({ expected, update }) => {
      await promptUpdateSelection([update])

      expect(cellOf('actions/cache', 'Target')).toBe(expected)
    })

    it('colors the Target against the version in the comment of a SHA pin', async () => {
      await promptUpdateSelection([
        makeUpdate({
          action: { comment: ' v4.2.3' },
          currentVersion: CURRENT_SHA,
          latestVersion: 'v4.2.4',
        }),
      ])

      expect(rowOf('actions/cache').message).toContain(
        `4.2.${colors.gray('4')}`,
      )
    })

    it('paints the Target of a major update red', async () => {
      await promptUpdateSelection([
        makeUpdate({ latestVersion: 'v5.0.0', isBreaking: true }),
      ])

      expect(rowOf('actions/cache').message).toContain(
        `${colors.redBright('5')}${colors.redBright('.')}${colors.redBright('0')}${colors.redBright('.')}${colors.redBright('0')}`,
      )
    })

    it('dims the action and the job of an update without a target', async () => {
      await promptUpdateSelection([makeUpdateWithoutTarget()])

      expect(rowOf('actions/cache').message).toContain(
        colors.gray('actions/cache'),
      )
      expect(rowOf('actions/cache').message).toContain(colors.gray('build'))
    })

    it('does not dim the action and the job of an update that has a target', async () => {
      await promptUpdateSelection([makeUpdate()])

      expect(rowOf('actions/cache').message).toMatch(/^actions\/cache {2}/u)
      expect(rowOf('actions/cache').message).toContain('  build  ')
    })

    it('lists a runner update under its runner name with the image labels as versions', async () => {
      await promptUpdateSelection([
        makeUpdate({
          action: { version: 'ubuntu-22.04', name: 'runner/ubuntu' },
          currentVersion: 'ubuntu-22.04',
          latestVersion: 'ubuntu-24.04',
          targetRef: 'ubuntu-24.04',
          targetRefStyle: 'tag',
          latestSha: null,
        }),
      ])

      expect([
        cellOf('runner/ubuntu', 'Current'),
        cellOf('runner/ubuntu', 'Target'),
      ]).toStrictEqual(['ubuntu-22.04', 'ubuntu-24.04'])
    })
  })

  describe('age column', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      {
        description: 'in hours when it is under a day old',
        publishedAt: hoursAgo(23),
        expected: '23h',
      },
      {
        description: 'in days once it is a whole day old',
        publishedAt: hoursAgo(24),
        expected: '1d',
      },
      {
        description: 'in days when it is under a week old',
        publishedAt: daysAgo(6),
        expected: '6d',
      },
      {
        description: 'in weeks once it is a whole week old',
        publishedAt: daysAgo(7),
        expected: '1w',
      },
      {
        description: 'in weeks and days past a whole week',
        publishedAt: daysAgo(10),
        expected: '1w 3d',
      },
      {
        description: 'in whole weeks without a day count',
        publishedAt: daysAgo(14),
        expected: '2w',
      },
    ])(
      'shows the age of a release $description',
      async ({ publishedAt, expected }) => {
        await promptUpdateSelection([makeUpdate({ publishedAt })], {
          showAge: true,
        })

        expect(cellOf('actions/cache', 'Age')).toBe(expected)
      },
    )

    it('leaves the Age cell empty for an update without a release date', async () => {
      await promptUpdateSelection(
        [
          makeUpdate({ publishedAt: daysAgo(3) }),
          makeUpdate({ action: { name: 'actions/checkout' } }),
        ],
        { showAge: true },
      )

      expect(cellOf('actions/checkout', 'Age')).toBe('')
    })

    it('hides the Age column unless it is requested', async () => {
      await promptUpdateSelection([makeUpdate({ publishedAt: daysAgo(3) })])

      expect(columnTitlesOf('workflows/ci.yml')).toStrictEqual([
        'Action',
        'Job',
        'Current',
        '❯',
        'Target',
      ])
    })

    it('hides the Age column when no update has a release date', async () => {
      await promptUpdateSelection([makeUpdate()], { showAge: true })

      expect(columnTitlesOf('workflows/ci.yml')).toStrictEqual([
        'Action',
        'Job',
        'Current',
        '❯',
        'Target',
      ])
    })

    it('lays out short values in columns of their minimum widths, two spaces apart', async () => {
      await promptUpdateSelection(
        [makeUpdate({ publishedAt: daysAgo(3), action: { job: 'ci' } })],
        { showAge: true },
      )

      expect(listedLines()).toStrictEqual([
        'workflows/ci.yml',
        ' ○ Action                                    Job   Current           ❯  Target           Age',
        'actions/cache                             ci    4.1.0             ❯  4.2.0 (0400d5f)  3d',
      ])
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it('warns about and skips a file group that disappears while the list is built', async () => {
      let originalGet = Map.prototype.get
      vi.spyOn(Map.prototype, 'get').mockImplementation(function (
        this: Map<unknown, unknown>,
        key: unknown,
      ): unknown {
        return key === 'workflows/ci.yml' ? undefined : (
            originalGet.call(this, key)
          )
      })

      await promptUpdateSelection([makeUpdate()])

      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'Unexpected missing group for file: workflows/ci.yml',
      )
      expect(prompt.shown().entries).toStrictEqual([])
    })
  })

  describe('current behavior pending owner decision', () => {
    it.each([
      {
        description: 'the current SHA has no version comment',
        currentVersion: CURRENT_SHA,
      },
      {
        description: 'the current version is missing',
        currentVersion: null,
      },
    ])(
      'keeps the v prefix of the Target when $description',
      async ({ currentVersion }) => {
        await promptUpdateSelection([makeUpdate({ currentVersion })])

        expect(cellOf('actions/cache', 'Target')).toBe('v4.2.0 (0400d5f)')
      },
    )

    it.each([
      {
        overrides: { currentVersion: 'v2025.9.0', latestVersion: 'v2025.10.1' },
        expected: '2025.10.1(0400d5f)',
        column: 'Target',
      },
      {
        overrides: {
          action: { comment: ' v2025.10.1' },
          latestVersion: 'v2025.11.0',
          currentVersion: CURRENT_SHA,
        },
        expected: '2025.10.1(11bd719)',
        column: 'Current',
      },
    ] satisfies {
      overrides: UpdateOverrides
      column: ColumnTitle
      expected: string
    }[])(
      'glues the short SHA to a version longer than the version column in $column',
      async ({ overrides, expected, column }) => {
        await promptUpdateSelection([makeUpdate(overrides)])

        expect(cellOf('actions/cache', column)).toBe(expected)
      },
    )

    it('shifts the arrow of a SHA pinned with a version comment one column right when a longer version follows it', async () => {
      await promptUpdateSelection([
        makeUpdate({
          action: { comment: ' v4.1.0' },
          currentVersion: CURRENT_SHA,
        }),
        makeUpdate({
          action: { name: 'actions/checkout' },
          latestVersion: 'v4.10.10',
        }),
      ])

      expect(listedLines()).toStrictEqual([
        'workflows/ci.yml',
        ' ○ Action                                    Job    Current           ❯  Target',
        'actions/cache                             build  4.1.0   (11bd719)  ❯  4.2.0   (0400d5f)',
        'actions/checkout                          build  4.1.0             ❯  4.10.10 (0400d5f)',
      ])
    })

    it('labels the group of an update without a file as a path above .github', async () => {
      await promptUpdateSelection([makeUpdate({ action: { file: undefined } })])

      expect(groupLabels()).toStrictEqual(['../unknown file'])
    })
  })
})
