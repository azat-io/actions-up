import type { EventEmitter } from 'node:events'
import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { PassThrough } from 'node:stream'
import enquirer from 'enquirer'
import pc from 'picocolors'

import type { GitHubAction } from '../../types/github-action'
import type { ActionUpdate } from '../../types/action-update'

import { promptUpdateSelection } from '../../core/interactive/prompt-update-selection'
import { stripAnsi } from '../../core/interactive/strip-ansi'

/**
 * Picocolors decides at import time whether to color, from the environment and
 * the terminal. The real library configured with colors on renders every row
 * the same way everywhere, and makes the column widths account for color codes
 * the way they must in a terminal.
 */
vi.mock(import('picocolors'), async importOriginal => {
  let { default: picocolors } = await importOriginal()
  return {
    default: {
      ...picocolors.createColors(true),
      createColors: picocolors.createColors,
    },
  }
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
 * Enquirer's real `prompt`, kept before the tests replace it with the stand-in.
 * Besides answering, it re-emits the events of the prompts it runs.
 */
let realPrompt = enquirer.prompt as Pick<EventEmitter, 'once'> &
  typeof enquirer.prompt

/**
 * Options the selection passes to `enquirer.prompt`.
 */
interface SelectionPromptOptions {
  /**
   * Draws the selection mark of a group label or a row.
   */
  indicator(state: unknown, choice: MarkedChoice): string

  /**
   * Group labels and the blank lines between them.
   */
  choices: (GroupLabelChoice | SeparatorChoice)[]

  /**
   * Moves the focus down on `j`.
   */
  j(this: MovementContext): Promise<string[]>

  /**
   * Moves the focus up on `k`.
   */
  k(this: MovementContext): Promise<string[]>

  /**
   * Summary printed next to the question.
   */
  format(this: FormatContext): string

  /**
   * Theme overrides.
   */
  styles: Record<string, unknown>

  /**
   * Names of the rows selected when the prompt opens.
   */
  initial: string[]

  /**
   * Glyph of the focused row.
   */
  pointer: string

  /**
   * Question shown above the list.
   */
  message: string

  /**
   * Text under the list.
   */
  footer: string

  /**
   * Key of the answer.
   */
  name: string

  /**
   * Prompt kind.
   */
  type: string
}

/**
 * In-memory stand-in for enquirer's multiselect prompt.
 */
interface FakeMultiselect {
  /**
   * Answer a prompt call once the user has pressed Enter.
   */
  answer(options: SelectionPromptOptions): Promise<Record<string, string[]>>

  /**
   * Choose the lines that are selected when the user presses Enter: group
   * labels by their file and rows by their action. Without a choice the user
   * presses Enter right away, on the lines the prompt pre-selected.
   */
  select(...texts: string[]): void

  /**
   * Options of the shown prompt; throws when the prompt was not shown.
   */
  shown(): SelectionPromptOptions

  /**
   * Make the prompt reject instead of answering.
   */
  failWith(error: Error): void

  /**
   * Summary enquirer prints next to the question after Enter; throws when the
   * prompt was not submitted.
   */
  summary(): string
}

/**
 * Selectable label of a file group, holding the lines of the group.
 */
interface GroupLabelChoice {
  /**
   * Column header followed by the rows of the group.
   */
  choices: (SeparatorChoice | RowChoice)[]

  /**
   * Marks the choice as a group label.
   */
  isGroupLabel: true

  /**
   * Whether the label itself is selected.
   */
  enabled: boolean

  /**
   * Visible text: the file of the group.
   */
  message: string

  /**
   * Name enquirer answers with when the label is selected.
   */
  name: string
}

/**
 * Selectable row of one update.
 */
interface RowChoice {
  /**
   * Whether the row cannot be selected.
   */
  disabled: boolean

  /**
   * Whether the row is selected.
   */
  enabled: boolean

  /**
   * Visible text.
   */
  message: string

  /**
   * Indentation enquirer puts before the row.
   */
  indent: string

  /**
   * Name enquirer answers with when the row is selected.
   */
  name: string
}

/**
 * Non-selectable line: a column header or the blank line between groups.
 */
interface SeparatorChoice {
  /**
   * Enquirer role that makes the line non-selectable.
   */
  role: 'separator'

  /**
   * Selection flag enquirer keeps on every line, separators included.
   */
  enabled?: boolean

  /**
   * Indentation enquirer puts before the line.
   */
  indent?: string

  /**
   * Visible text.
   */
  message: string
}

/**
 * Choice enquirer draws a selection mark for.
 */
interface MarkedChoice {
  /**
   * Lines of a group label.
   */
  choices?: (SeparatorChoice | RowChoice)[]

  /**
   * Whether the choice is a group label.
   */
  isGroupLabel?: boolean

  /**
   * Whether the choice is selected.
   */
  enabled?: boolean
}

/**
 * Prompt state enquirer calls the format hook with.
 */
interface FormatContext {
  /**
   * Whether the prompt was submitted or cancelled.
   */
  state: { cancelled: boolean; submitted: boolean }

  /**
   * Names of the selected choices once submitted.
   */
  value: string[] | string
}

/**
 * Prompt state enquirer calls the movement hooks with.
 */
interface MovementContext {
  /**
   * Moves the focus down.
   */
  down?(): Promise<string[]>

  /**
   * Moves the focus up.
   */
  up?(): Promise<string[]>
}

/**
 * Fields of an update to replace; `action` fields are merged into the default
 * action.
 */
type UpdateOverrides = Partial<Omit<ActionUpdate, 'action'>> & {
  action?: Partial<GitHubAction>
}

/**
 * `enquirer.prompt` narrowed to the call the selection makes.
 */
type SelectionPrompt = (
  options: SelectionPromptOptions,
) => Promise<Record<string, string[]>>

/**
 * Column titles of the table.
 */
type ColumnTitle = 'Current' | 'Action' | 'Target' | 'Job' | 'Age'

let prompt = createFakeMultiselect()

/**
 * Create the multiselect stand-in.
 *
 * Like enquirer 2.4.1, it keeps the selection on the choice objects: on start
 * every line is unselected, whatever `enabled` flags the choices were handed
 * with, and then the rows named in `initial` are selected; selecting a group
 * label selects it and every line of its group that is not disabled, the column
 * header included; a disabled row cannot be selected. On Enter it answers with
 * the names of the selected labels and rows, and renders the summary through
 * the `format` hook.
 *
 * @returns Fake whose `answer` stands in for `enquirer.prompt`.
 */
function createFakeMultiselect(): FakeMultiselect {
  let shownOptions: SelectionPromptOptions | null = null
  let selectedTexts: string[] | null = null
  let summary: string | null = null
  let failure: Error | null = null

  /**
   * Options of the shown prompt.
   *
   * @returns Options passed to the last prompt call.
   */
  function shown(): SelectionPromptOptions {
    if (!shownOptions) {
      throw new Error('The selection prompt was not shown')
    }
    return shownOptions
  }

  return {
    answer(options) {
      shownOptions = options
      clearSelection(options.choices)
      for (let name of options.initial) {
        let row = findRowNamed(options.choices, name)
        row.enabled = !row.disabled
      }
      if (failure) {
        return Promise.reject(failure)
      }
      if (selectedTexts) {
        clearSelection(options.choices)
        for (let text of selectedTexts) {
          selectLine(findListed(options.choices, text))
        }
      }
      let value = selectableLinesOf(options.choices)
        .filter(line => line.enabled)
        .map(line => line.name)
      summary = options.format.call({
        state: { cancelled: false, submitted: true },
        value,
      })
      return Promise.resolve({ [options.name]: value })
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
 * Text of one cell of an update's row, read under its column title the way a
 * person reads the table.
 *
 * @param action - Action shown in the row.
 * @param title - Title of the column.
 * @returns Visible cell text without padding.
 */
function cellOf(action: string, title: ColumnTitle): string {
  let row = rowOf(action)
  let group = prompt
    .shown()
    .choices.filter(isGroupLabel)
    .find(label => label.choices.includes(row))
  let header = headerOf(group!)
  let titles = header.split(/ {2,}/u)
  if (!titles.includes(title)) {
    throw new Error(`The table has no ${title} column`)
  }
  let text = stripAnsi(row.message)
  let nextTitle = titles[titles.indexOf(title) + 1]
  let end = nextTitle === undefined ? text.length : header.indexOf(nextTitle)
  return text.slice(header.indexOf(title), end).trim()
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
 * Group label or row whose first cell shows the given text.
 *
 * @param choices - Choices the prompt was shown with.
 * @param text - File of a group label or action of a row.
 * @returns Matching group label or row.
 */
function findListed(
  choices: SelectionPromptOptions['choices'],
  text: string,
): GroupLabelChoice | RowChoice {
  let labels = choices.filter(isGroupLabel)
  let rows = labels.flatMap(label => label.choices.filter(isRow))
  let listed = [...labels, ...rows].find(
    choice => firstCellOf(choice.message) === text,
  )
  if (!listed) {
    throw new Error(`Nothing is listed as ${text}`)
  }
  return listed
}

/**
 * Select a line the way enquirer does when the user presses space on it.
 *
 * @param choice - Group label or row to select.
 */
function selectLine(choice: GroupLabelChoice | RowChoice): void {
  if (isGroupLabel(choice)) {
    choice.enabled = true
    for (let line of choice.choices) {
      line.enabled = !isRow(line) || !line.disabled
    }
    return
  }
  if (choice.disabled) {
    throw new Error(`A disabled row cannot be selected: ${choice.message}`)
  }
  choice.enabled = true
}

/**
 * Row with the given name, the way enquirer finds a choice named in `initial`.
 *
 * @param choices - Choices the prompt was shown with.
 * @param name - Index of the update, the name enquirer answers with.
 * @returns Row with that name.
 */
function findRowNamed(
  choices: SelectionPromptOptions['choices'],
  name: string,
): RowChoice {
  let row = selectableLinesOf(choices).find(line => line.name === name)
  if (!row || isGroupLabel(row)) {
    throw new Error(`No row is named ${name}`)
  }
  return row
}

/**
 * Every line of the list, separators included, the way enquirer flattens it.
 *
 * @param choices - Choices the prompt was shown with.
 * @returns Group labels with their headers and rows, and blank lines.
 */
function everyLineOf(
  choices: SelectionPromptOptions['choices'],
): (GroupLabelChoice | SeparatorChoice | RowChoice)[] {
  return choices.flatMap(choice =>
    isGroupLabel(choice) ? [choice, ...choice.choices] : [choice],
  )
}

/**
 * Group labels and rows in listed order: the lines enquirer can answer with.
 *
 * @param choices - Choices the prompt was shown with.
 * @returns Each group label followed by the rows of its group.
 */
function selectableLinesOf(
  choices: SelectionPromptOptions['choices'],
): (GroupLabelChoice | RowChoice)[] {
  return choices
    .filter(isGroupLabel)
    .flatMap(label => [label, ...label.choices.filter(isRow)])
}

/**
 * Group label of a file in the shown prompt.
 *
 * @param file - File shown in the label.
 * @returns Label whose text is the file, holding the lines of its group.
 */
function groupOf(file: string): GroupLabelChoice {
  let listed = findListed(prompt.shown().choices, file)
  if (!isGroupLabel(listed)) {
    throw new Error(`${file} is a row, not a group label`)
  }
  return listed
}

/**
 * Row of the update of an action in the shown prompt.
 *
 * @param action - Action shown in the row.
 * @returns Row whose first cell is the action.
 */
function rowOf(action: string): RowChoice {
  let listed = findListed(prompt.shown().choices, action)
  if (isGroupLabel(listed)) {
    throw new Error(`${action} is a group label, not a row`)
  }
  return listed
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
 * Column header of a group without its leading mark.
 *
 * @param group - Group label.
 * @returns Visible header text.
 */
function headerOf(group: GroupLabelChoice): string {
  let header = group.choices.find(choice => !isRow(choice))
  return stripAnsi(header?.message ?? '').replace(/^ ○ /u, '')
}

/**
 * Unselect every line, separators included, the way enquirer does on start.
 *
 * @param choices - Choices the prompt was shown with.
 */
function clearSelection(choices: SelectionPromptOptions['choices']): void {
  for (let line of everyLineOf(choices)) {
    line.enabled = false
  }
}

/**
 * Whether a choice is the label of a file group.
 *
 * @param choice - Choice to check.
 * @returns True for a group label.
 */
function isGroupLabel(
  choice: GroupLabelChoice | SeparatorChoice | RowChoice,
): choice is GroupLabelChoice {
  return 'isGroupLabel' in choice
}

/**
 * Visible text of the group labels, top to bottom.
 *
 * @returns Files shown in the group labels.
 */
function groupLabels(): string[] {
  return prompt
    .shown()
    .choices.filter(isGroupLabel)
    .map(choice => stripAnsi(choice.message))
}

/**
 * Visible text of every listed line, top to bottom.
 *
 * @returns Group labels, column headers, rows and blank lines.
 */
function listedLines(): string[] {
  return everyLineOf(prompt.shown().choices).map(line =>
    stripAnsi(line.message),
  )
}

/**
 * Whether a line of a group is the row of an update.
 *
 * @param choice - Line of a group.
 * @returns True for a row, false for the column header.
 */
function isRow(choice: SeparatorChoice | RowChoice): choice is RowChoice {
  return !('role' in choice)
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
 * Column titles of the group of a file, left to right.
 *
 * @param file - File shown in the group label.
 * @returns Titles in the column header.
 */
function columnTitlesOf(file: string): string[] {
  return headerOf(groupOf(file)).split(/ {2,}/u)
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
    vi.spyOn(enquirer, 'prompt')
    vi.mocked<SelectionPrompt>(enquirer.prompt).mockImplementation(options =>
      prompt.answer(options),
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
    expect(pc.gray('x')).not.toBe('x')
  })

  it('returns null silently, without showing the prompt, when there are no updates', async () => {
    let result = await promptUpdateSelection([])

    expect(result).toBeNull()
    expect(info).not.toHaveBeenCalled()
    expect(enquirer.prompt).not.toHaveBeenCalled()
  })

  it('reports that every action is up to date, without showing the prompt, when nothing is outdated', async () => {
    let result = await promptUpdateSelection([makeUpdate({ hasUpdate: false })])

    expect(result).toBeNull()
    expect(info).toHaveBeenCalledExactlyOnceWith(
      pc.green('✓ All actions are up to date!'),
    )
    expect(enquirer.prompt).not.toHaveBeenCalled()
  })

  it('shows a multiselect prompt that explains its keys', async () => {
    await promptUpdateSelection([makeUpdate()])

    expect(prompt.shown()).toMatchObject({
      message: `Choose which actions to update (Press ${pc.cyan('<space>')} to select, ${pc.cyan('<a>')} to toggle all, ${pc.cyan('<i>')} to invert selection)`,
      styles: { success: pc.reset, dark: pc.reset, em: pc.bgBlack },
      footer: '\nEnter to start updating. Ctrl-c to cancel.',
      type: 'multiselect',
      pointer: '❯',
    })
  })

  it('logs and rethrows an unexpected failure of the prompt', async () => {
    let failure = new Error('terminal closed')
    prompt.failWith(failure)

    await expect(promptUpdateSelection([makeUpdate()])).rejects.toBe(failure)

    expect(error).toHaveBeenCalledExactlyOnceWith(
      pc.red('Unexpected error during selection:'),
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
        pc.yellow('\nNo actions selected'),
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

      expect(groupOf('workflows/ci.yml').choices).toMatchObject([
        {},
        { disabled: false },
        { disabled: true },
      ])
    })
  })

  describe('prompt hooks', () => {
    it.each([
      {
        description: 'a group label after the user selects the group',
        selection: ['workflows/ci.yml'],
        expected: ` ${pc.gray('●')}`,
        text: 'workflows/ci.yml',
      },
      {
        description: 'a group label after the user selects each of its rows',
        selection: ['actions/cache', 'actions/checkout'],
        expected: ` ${pc.gray('●')}`,
        text: 'workflows/ci.yml',
      },
      {
        description: 'a group label with a row the user leaves unselected',
        expected: ` ${pc.gray('○')}`,
        selection: ['actions/cache'],
        text: 'workflows/ci.yml',
      },
      {
        description: 'a row the user selects',
        selection: ['actions/cache'],
        text: 'actions/cache',
        expected: '   ●',
      },
      {
        description: 'a row the user leaves unselected',
        selection: ['actions/cache'],
        text: 'actions/checkout',
        expected: '   ○',
      },
    ])(
      'draws the mark of $description',
      async ({ selection, expected, text }) => {
        prompt.select(...selection)
        await promptUpdateSelection([
          makeUpdate(),
          makeUpdate({ action: { name: 'actions/checkout' } }),
        ])

        let mark = prompt
          .shown()
          .indicator({}, findListed(prompt.shown().choices, text))

        expect(mark).toBe(expected)
      },
    )

    it.each([
      { direction: 'down', key: 'j' },
      { direction: 'up', key: 'k' },
    ] as const)(
      'moves the focus $direction on $key',
      async ({ direction, key }) => {
        await promptUpdateSelection([makeUpdate()])
        let promptState = {
          down: () => Promise.resolve(['focus moved down']),
          up: () => Promise.resolve(['focus moved up']),
        }

        let moved = prompt.shown()[key].call(promptState)

        await expect(moved).resolves.toStrictEqual([`focus moved ${direction}`])
      },
    )

    it.each([
      {
        state: { cancelled: false, submitted: false },
        moment: 'while the prompt is still open',
      },
      {
        state: { cancelled: true, submitted: true },
        moment: 'after the prompt is cancelled',
      },
    ])('prints no summary $moment', async ({ state }) => {
      await promptUpdateSelection([makeUpdate()])
      let value = [rowOf('actions/cache').name]

      let summary = prompt.shown().format.call({ state, value })

      expect(summary).toBe('')
    })
  })

  describe('in a terminal', () => {
    /**
     * Run the next selection on enquirer's real prompt in a fake terminal and
     * type the given keys once the prompt is shown. Pre-selection and
     * cancellation depend on how enquirer itself treats the options, which the
     * stand-in only imitates.
     *
     * @param keys - Raw key sequences, such as `\r` for Enter.
     */
    function typeIntoPrompt(...keys: string[]): void {
      let stdin = Object.assign(new PassThrough(), {
        setRawMode: () => {},
        isRaw: false,
        isTTY: true,
      })
      let stdout = new PassThrough()
      stdout.resume()

      realPrompt.once('prompt', (shownPrompt: EventEmitter) => {
        shownPrompt.once('run', () => {
          for (let key of keys) {
            stdin.write(key)
          }
        })
      })
      vi.mocked<SelectionPrompt>(enquirer.prompt).mockImplementationOnce(
        options =>
          realPrompt<Record<string, string[]>>({
            ...options,
            stdout,
            stdin,
          } as never),
      )
    }

    it('submits the updates that have a target and are not breaking when the user presses Enter right away', async () => {
      let cache = makeUpdate()
      let checkout = makeUpdate({
        action: { name: 'actions/checkout' },
        latestVersion: 'v5.0.0',
        isBreaking: true,
      })
      let setupNode = makeUpdateWithoutTarget({
        action: { name: 'actions/setup-node' },
      })
      typeIntoPrompt('\r')

      let result = await promptUpdateSelection([checkout, cache, setupNode])

      expect(result).toStrictEqual([cache])
    })

    it.each([
      { name: 'Ctrl-C', key: '\u{3}' },
      { key: '\u{1B}', name: 'Esc' },
    ])(
      'closes the prompt and returns null when the user cancels with $name',
      async ({ key }) => {
        typeIntoPrompt(key)

        let result = await promptUpdateSelection([makeUpdate()])

        expect(result).toBeNull()
        expect(info).toHaveBeenCalledExactlyOnceWith(
          `\r\u{1B}[K${pc.yellow('Selection cancelled')}`,
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

      expect(prompt.shown().choices).toMatchObject([
        { choices: [{ role: 'separator' }, {}] },
        { role: 'separator', message: ' ' },
        { choices: [{ role: 'separator' }, {}] },
      ])
    })

    it('does not indent the lines of a group under its label', async () => {
      await promptUpdateSelection([makeUpdate()])

      expect(groupOf('workflows/ci.yml').choices).toMatchObject([
        { indent: '' },
        { indent: '' },
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

      expect(rowOf('actions/cache').message).toContain(`4.2.${pc.gray('4')}`)
    })

    it('paints the Target of a major update red', async () => {
      await promptUpdateSelection([
        makeUpdate({ latestVersion: 'v5.0.0', isBreaking: true }),
      ])

      expect(rowOf('actions/cache').message).toContain(
        `${pc.redBright('5')}${pc.redBright('.')}${pc.redBright('0')}${pc.redBright('.')}${pc.redBright('0')}`,
      )
    })

    it('dims the action and the job of an update without a target', async () => {
      await promptUpdateSelection([makeUpdateWithoutTarget()])

      expect(rowOf('actions/cache').message).toContain(pc.gray('actions/cache'))
      expect(rowOf('actions/cache').message).toContain(pc.gray('build'))
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
      expect(prompt.shown().choices).toStrictEqual([])
    })

    it('treats a prompt rejection that mentions cancellation as a cancelled selection', async () => {
      prompt.failWith(new Error('Prompt cancelled by user'))

      let result = await promptUpdateSelection([makeUpdate()])

      expect(result).toBeNull()
      expect(info).toHaveBeenCalledExactlyOnceWith(
        `\r\u{1B}[K${pc.yellow('Selection cancelled')}`,
      )
    })

    it('counts the updates with a target of a group label answered without its rows', async () => {
      await promptUpdateSelection([
        makeUpdate(),
        makeUpdate({ action: { name: 'actions/checkout' } }),
        makeUpdateWithoutTarget({ action: { name: 'actions/setup-node' } }),
      ])

      let summary = prompt.shown().format.call({
        state: { cancelled: false, submitted: true },
        value: [groupOf('workflows/ci.yml').name],
      })

      expect(summary).toBe('2 actions selected')
    })

    it('counts no action for an answered row that has no target', async () => {
      await promptUpdateSelection([
        makeUpdate(),
        makeUpdateWithoutTarget({ action: { name: 'actions/setup-node' } }),
      ])

      let summary = prompt.shown().format.call({
        state: { cancelled: false, submitted: true },
        value: [rowOf('actions/setup-node').name],
      })

      expect(summary).toBe('')
    })

    it('counts no action for answer values that name no listed line', async () => {
      await promptUpdateSelection([makeUpdate()])
      let removedGroup = `${groupOf('workflows/ci.yml').name}.removed`

      let summary = prompt.shown().format.call({
        state: { cancelled: false, submitted: true },
        value: [removedGroup, 'not-a-row'],
      })

      expect(summary).toBe('')
    })

    it('prints no summary when the submitted value is not a list', async () => {
      await promptUpdateSelection([makeUpdate()])

      let summary = prompt.shown().format.call({
        state: { cancelled: false, submitted: true },
        value: rowOf('actions/cache').name,
      })

      expect(summary).toBe('')
    })

    it('draws a filled mark for a group label without rows', async () => {
      await promptUpdateSelection([makeUpdate()])

      let mark = prompt.shown().indicator({}, { isGroupLabel: true })

      expect(mark).toBe(` ${pc.gray('●')}`)
    })

    it.each(['j', 'k'] as const)(
      'resolves an empty list on %s when the prompt cannot move the focus',
      async key => {
        await promptUpdateSelection([makeUpdate()])

        let moved = prompt.shown()[key].call({})

        await expect(moved).resolves.toStrictEqual([])
      },
    )
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
