import {
  beforeEach,
  afterEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { setTimeout } from 'node:timers/promises'
import path from 'node:path'

import type { FakeTerminal } from '../../helpers/create-fake-terminal'
import type { ActionUpdate } from '../../../types/action-update'

import { promptUpdateSelection } from '../../../core/interactive/prompt-update-selection'
import { createFakeTerminal } from '../../helpers/create-fake-terminal'

/**
 * The colors module decides whether to color when it loads. FORCE_COLOR turns
 * colors on, as a terminal does, whatever the environment of the test run says.
 * It works because every test file loads its modules afresh, as vitest isolates
 * test files by default.
 */
vi.hoisted(() => {
  vi.stubEnv('FORCE_COLOR', '1')
  vi.stubEnv('NO_COLOR', undefined)
})

/**
 * Keys as a terminal in raw mode sends them.
 */
const KEY = {
  tmuxHome: '\u{1B}[1~',
  shiftTab: '\u{1B}[Z',
  tmuxEnd: '\u{1B}[4~',
  right: '\u{1B}[C',
  escape: '\u{1B}',
  down: '\u{1B}[B',
  home: '\u{1B}[H',
  left: '\u{1B}[D',
  end: '\u{1B}[F',
  up: '\u{1B}[A',
  ctrlC: '\u{3}',
  enter: '\r',
  space: ' ',
  tab: '\t',
}

/**
 * Moment the release ages are measured from.
 */
const NOW = new Date('2026-01-15T10:00:00Z')

/**
 * One hour in milliseconds.
 */
const HOUR = 60 * 60 * 1000

/**
 * One day in milliseconds.
 */
const DAY = 24 * HOUR

/**
 * Time after Esc, in milliseconds, at which the prompt has to be still open. It
 * is shorter than the 500 ms readline waits to tell Esc from the start of
 * another key, and counted from before the key is sent, so it always ends
 * first.
 */
const BEFORE_ESCAPE_TIMEOUT = 400

/**
 * Key the user presses, and what it does, as the heading of the screen after
 * it.
 */
interface Step {
  /**
   * What the key does.
   */
  label: string

  /**
   * The key as a terminal in raw mode sends it.
   */
  key: string
}

/**
 * Updates of a repository with a composite action and a workflow, one of each
 * kind the list draws differently:
 *
 * - `actions/cache`: a SHA pinned with a version comment, a patch update;
 *   preselected.
 * - `docker/build-push-action`: a SHA pinned without a comment, a breaking
 *   update.
 * - `actions/setup-python`: up to date, not listed.
 * - `actions/checkout`: a SHA pinned with a version comment, a breaking update.
 * - `actions/setup-node`: a minor update to a tag; preselected.
 * - `aquasecurity/trivy-action`: a minor update below 1.0.0 to a tag, without a
 *   release date; preselected.
 * - `some-org/private-action`: an update without a target, which cannot be
 *   selected.
 * - `runner/ubuntu`: a runner image update, the last row.
 *
 * @returns The updates in scan order.
 */
function createUpdates(): ActionUpdate[] {
  let compositeAction = githubFile('actions/setup/action.yml')
  let workflow = githubFile('workflows/ci.yml')
  return [
    {
      action: {
        uses: 'actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57',
        ref: 'actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57',
        version: '1bd1e32a3bdc45362d1e726936510720a7c30a57',
        file: compositeAction,
        name: 'actions/cache',
        comment: ' v4.2.0',
        type: 'external',
        line: 12,
      },
      currentVersion: '1bd1e32a3bdc45362d1e726936510720a7c30a57',
      latestSha: '5a3ec84eff668545956fd18022155c47e93e2684',
      targetRef: '5a3ec84eff668545956fd18022155c47e93e2684',
      publishedAt: new Date(NOW.getTime() - 5 * HOUR),
      latestVersion: 'v4.2.3',
      currentRefType: 'sha',
      targetRefStyle: 'sha',
      isBreaking: false,
      hasUpdate: true,
    },
    {
      action: {
        uses: 'docker/build-push-action@4afd733a84b1f43292c63897423277bb7f4313a9',
        ref: 'docker/build-push-action@4afd733a84b1f43292c63897423277bb7f4313a9',
        version: '4afd733a84b1f43292c63897423277bb7f4313a9',
        name: 'docker/build-push-action',
        file: compositeAction,
        type: 'external',
        line: 20,
      },
      currentVersion: '4afd733a84b1f43292c63897423277bb7f4313a9',
      publishedAt: new Date(NOW.getTime() - 2 * DAY - 3 * HOUR),
      latestSha: '55c2c1448f86e01eaae002a5a3a9624417608d84',
      targetRef: '55c2c1448f86e01eaae002a5a3a9624417608d84',
      latestVersion: 'v6.18.0',
      currentRefType: 'sha',
      targetRefStyle: 'sha',
      isBreaking: true,
      hasUpdate: true,
    },
    {
      action: {
        uses: 'actions/setup-python@v5',
        name: 'actions/setup-python',
        type: 'external',
        file: workflow,
        version: 'v5',
        job: 'build',
        line: 30,
      },
      latestSha: 'a26af69be951a213d495a4c3e4e4022e16d87065',
      publishedAt: new Date(NOW.getTime() - 30 * DAY),
      latestVersion: 'v5.6.0',
      currentRefType: 'tag',
      currentVersion: 'v5',
      isBreaking: false,
      hasUpdate: false,
    },
    {
      action: {
        uses: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        ref: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
        version: '11bd71901bbe5b1630ceea73d27597364c9af683',
        name: 'actions/checkout',
        comment: ' v4.2.2',
        type: 'external',
        file: workflow,
        job: 'build',
        line: 14,
      },
      publishedAt: new Date(NOW.getTime() - 10 * DAY - 2 * HOUR),
      currentVersion: '11bd71901bbe5b1630ceea73d27597364c9af683',
      latestSha: '08c6903cd8c0fde910a37f88322edcfb5dd907a8',
      targetRef: '08c6903cd8c0fde910a37f88322edcfb5dd907a8',
      latestVersion: 'v5.0.0',
      currentRefType: 'sha',
      targetRefStyle: 'sha',
      isBreaking: true,
      hasUpdate: true,
    },
    {
      action: {
        uses: 'actions/setup-node@v4.0.0',
        ref: 'actions/setup-node@v4.0.0',
        name: 'actions/setup-node',
        version: 'v4.0.0',
        type: 'external',
        file: workflow,
        job: 'build',
        line: 17,
      },
      publishedAt: new Date(NOW.getTime() - 14 * DAY - HOUR),
      latestSha: '49933ea5288caeca8642d1e84afbd3f7d6820020',
      currentVersion: 'v4.0.0',
      latestVersion: 'v4.4.0',
      currentRefType: 'tag',
      targetRefStyle: 'tag',
      targetRef: 'v4.4.0',
      isBreaking: false,
      hasUpdate: true,
    },
    {
      action: {
        uses: 'aquasecurity/trivy-action@v0.28.0',
        ref: 'aquasecurity/trivy-action@v0.28.0',
        name: 'aquasecurity/trivy-action',
        version: 'v0.28.0',
        type: 'external',
        file: workflow,
        job: 'lint',
        line: 41,
      },
      latestSha: 'e04ffabe3898a0af8d0fb1af00c188831c4b5893',
      currentVersion: 'v0.28.0',
      latestVersion: 'v0.32.0',
      currentRefType: 'tag',
      targetRefStyle: 'tag',
      targetRef: 'v0.32.0',
      isBreaking: false,
      publishedAt: null,
      hasUpdate: true,
    },
    {
      action: {
        uses: 'some-org/private-action@v1.2.0',
        ref: 'some-org/private-action@v1.2.0',
        name: 'some-org/private-action',
        version: 'v1.2.0',
        type: 'external',
        file: workflow,
        job: 'lint',
        line: 45,
      },
      publishedAt: new Date(NOW.getTime() - 40 * DAY - 5 * HOUR),
      currentVersion: 'v1.2.0',
      latestVersion: 'v2.0.0',
      currentRefType: 'tag',
      targetRefStyle: null,
      isBreaking: true,
      latestSha: null,
      targetRef: null,
      hasUpdate: true,
    },
    {
      action: {
        version: 'ubuntu-22.04',
        name: 'runner/ubuntu',
        type: 'runner',
        file: workflow,
        job: 'test',
        line: 52,
      },
      currentVersion: 'ubuntu-22.04',
      latestVersion: 'ubuntu-24.04',
      targetRef: 'ubuntu-24.04',
      targetRefStyle: 'tag',
      publishedAt: null,
      isBreaking: true,
      latestSha: null,
      hasUpdate: true,
    },
  ]
}

/**
 * Run the selection prompt in a fake terminal below the lines the CLI prints
 * before it, press the keys, and take the screen at the start, after every key,
 * and once the prompt closes.
 *
 * @param scenario - What to run.
 * @param scenario.columns - Width of the terminal.
 * @param scenario.rows - Height of the terminal, 40 by default.
 * @param scenario.linesBefore - Number of lines printed before the prompt, 1 by
 *   default.
 * @param scenario.showAge - Whether to show the Age column.
 * @param scenario.steps - Keys pressed while the prompt stays open.
 * @param scenario.close - Key that closes the prompt.
 * @returns The screens, and the names of the selected actions or null.
 */
async function runPrompt(scenario: {
  linesBefore?: number
  showAge?: boolean
  columns: number
  rows?: number
  steps: Step[]
  close: Step
}): Promise<{ selected: string[] | null; screens: string }> {
  let terminal = createFakeTerminal({
    rows: scenario.rows ?? 40,
    columns: scenario.columns,
  })
  printLinesBefore(scenario.linesBefore ?? 1)
  let selection = promptUpdateSelection(createUpdates(), {
    showAge: scenario.showAge ?? false,
  })
  await terminal.settle()
  let initialScreen = `=== initial ===\n${terminal.screen()}`
  let stepScreens = await pressEach(terminal, scenario.steps)
  await terminal.press(scenario.close.key)
  let selected = await selection
  await terminal.settle()
  let closedScreen = `=== ${scenario.close.label} ===\n${terminal.screen()}`
  return {
    screens: `${[initialScreen, ...stepScreens, closedScreen].join('\n\n')}\n`,
    selected: selected?.map(update => update.action.name) ?? null,
  }
}

/**
 * Press the keys one by one and take the screen after each of them.
 *
 * @param terminal - Terminal the prompt runs in.
 * @param steps - Keys to press, in order.
 * @returns The screens, each under the heading of its key.
 */
async function pressEach(
  terminal: FakeTerminal,
  steps: Step[],
): Promise<string[]> {
  let [step, ...rest] = steps
  if (!step) {
    return []
  }
  await terminal.press(step.key)
  let screen = `=== ${step.label} ===\n${terminal.screen()}`
  return [screen, ...(await pressEach(terminal, rest))]
}

/**
 * Print numbered lines the way the CLI prints its output before the prompt, so
 * that the screens show whether the prompt leaves them alone.
 *
 * @param count - Number of lines.
 */
function printLinesBefore(count: number): void {
  for (let line = 1; line <= count; line++) {
    console.info(`Line ${line} printed before the prompt`)
  }
}

/**
 * Path of a file under the `.github` directory of the working directory.
 *
 * @param name - Path inside `.github`.
 * @returns Absolute path.
 */
function githubFile(name: string): string {
  return path.join(process.cwd(), '.github', name)
}

describe('promptUpdateSelection on screen', () => {
  beforeEach(() => {
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
  })

  it('draws the list with the preselected updates and submits them on Enter', async () => {
    let { selected, screens } = await runPrompt({
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 120,
      steps: [],
    })

    await expect(screens).toMatchFileSnapshot('__screens__/submit.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('moves the focus over the rows and files, past the lines that cannot be selected', async () => {
    let { selected, screens } = await runPrompt({
      steps: [
        { label: 'Down moves past the column header', key: KEY.down },
        { label: 'j moves down', key: 'j' },
        { label: 'Tab moves past the blank line to a file', key: KEY.tab },
        { label: 'End moves to the last row', key: KEY.end },
        { label: 'k moves up past a row without a target', key: 'k' },
        { label: 'j moves down past a row without a target', key: 'j' },
        { label: 'Up moves up past a row without a target', key: KEY.up },
        { label: 'Shift+Tab moves up', key: KEY.shiftTab },
        { label: 'Up moves up', key: KEY.up },
        { label: 'K moves up past the column header', key: 'K' },
        {
          label: 'Up moves past the blank line to the last row of a file',
          key: KEY.up,
        },
        { label: 'Down moves past the blank line to a file', key: KEY.down },
        { label: 'J moves down past the column header', key: 'J' },
        { label: 'Home moves to the first file', key: KEY.home },
        { label: 'Up wraps to the last row', key: KEY.up },
        { label: 'Down wraps to the first file', key: KEY.down },
        { label: 'Shift+Tab wraps to the last row', key: KEY.shiftTab },
        { label: 'Tab wraps to the first file', key: KEY.tab },
        {
          label: 'End as tmux sends it moves to the last row',
          key: KEY.tmuxEnd,
        },
        {
          label: 'Home as tmux sends it moves to the first file',
          key: KEY.tmuxHome,
        },
      ],
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 120,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/navigate.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('rings the bell on keys that do nothing', async () => {
    let { selected, screens } = await runPrompt({
      steps: [
        { label: 'Left rings the bell', key: KEY.left },
        { label: 'Right rings the bell', key: KEY.right },
        { label: 'x rings the bell', key: 'x' },
      ],
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 120,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/bell.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('selects and deselects rows, files, everything and the inverse', async () => {
    let { selected, screens } = await runPrompt({
      steps: [
        { label: 'Space selects every row of the file', key: KEY.space },
        { label: 'Space deselects every row of the file', key: KEY.space },
        { label: 'Down moves to a row', key: KEY.down },
        { label: 'Space selects the row', key: KEY.space },
        { label: 'a selects every row', key: 'a' },
        { label: 'a deselects every row', key: 'a' },
        { label: 'i inverts the selection', key: 'i' },
        { label: 'g deselects the rows of the file', key: 'g' },
        { label: 'G selects the rows of the file', key: 'G' },
        { label: 'I inverts the selection', key: 'I' },
        { label: 'Down moves to the next row', key: KEY.down },
        { label: 'Space selects the row', key: KEY.space },
        { label: 'A selects every row', key: 'A' },
        { label: 'Down moves to the next file', key: KEY.down },
        { label: 'g deselects every row of the file', key: 'g' },
        { label: 'G selects every row of the file', key: 'G' },
        { label: 'Space deselects every row of the file', key: KEY.space },
        { label: 'Down moves to a row', key: KEY.down },
        { label: 'Space selects the row', key: KEY.space },
      ],
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 120,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/select.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'docker/build-push-action',
      'actions/checkout',
    ])
  })

  it('says that one action was selected when the user submits a single row', async () => {
    let { selected, screens } = await runPrompt({
      steps: [
        { label: 'a selects every row', key: 'a' },
        { label: 'a deselects every row', key: 'a' },
        { label: 'Down moves to a row', key: KEY.down },
        { label: 'Space selects the row', key: KEY.space },
      ],
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 120,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/submit-one.txt')
    expect(selected).toStrictEqual(['actions/cache'])
  })

  it('says that nothing was selected when the user submits an empty selection', async () => {
    let { selected, screens } = await runPrompt({
      steps: [
        { label: 'a selects every row', key: 'a' },
        { label: 'a deselects every row', key: 'a' },
      ],
      close: { label: 'Enter submits nothing', key: KEY.enter },
      columns: 120,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/submit-empty.txt')
    expect(selected).toBeNull()
  })

  it.each([
    { snapshot: 'cancel-ctrl-c', name: 'Ctrl+C', key: KEY.ctrlC },
    { snapshot: 'cancel-escape', key: KEY.escape, name: 'Esc' },
  ])(
    'closes the prompt as cancelled when the user presses $name',
    async ({ snapshot, name, key }) => {
      let { selected, screens } = await runPrompt({
        steps: [{ label: 'Down moves to a row', key: KEY.down }],
        close: { label: `${name} cancels`, key },
        columns: 120,
      })

      await expect(screens).toMatchFileSnapshot(`__screens__/${snapshot}.txt`)
      expect(selected).toBeNull()
    },
  )

  it('keeps the prompt open after Esc until the escape timeout passes', async () => {
    let terminal = createFakeTerminal({ columns: 120, rows: 40 })
    let selection = promptUpdateSelection(createUpdates())
    await terminal.settle()
    let openScreen = terminal.screen()

    let checkpoint = setTimeout(BEFORE_ESCAPE_TIMEOUT)
    await terminal.press(KEY.escape)
    await checkpoint

    expect(terminal.screen()).toBe(openScreen)
    await expect(selection).resolves.toBeNull()
  })

  it('shows how old every release is in the Age column', async () => {
    let { selected, screens } = await runPrompt({
      close: { label: 'Enter submits the selection', key: KEY.enter },
      steps: [{ label: 'Down moves to a row', key: KEY.down }],
      showAge: true,
      columns: 130,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/age.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('wraps the rows in a narrow terminal and redraws them cleanly', async () => {
    let { selected, screens } = await runPrompt({
      steps: [
        { label: 'Down moves to a row', key: KEY.down },
        { label: 'Space deselects the row', key: KEY.space },
      ],
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 70,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/narrow.txt')
    expect(selected).toStrictEqual([
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('leaves no blank line after the submitted question when it fills the width exactly', async () => {
    let { selected, screens } = await runPrompt({
      close: { label: 'Enter submits the selection', key: KEY.enter },
      columns: 123,
      steps: [],
    })

    await expect(screens).toMatchFileSnapshot('__screens__/exact-width.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('keeps the output above the list when it opens at the bottom of a full screen', async () => {
    let { selected, screens } = await runPrompt({
      close: { label: 'Enter submits the selection', key: KEY.enter },
      steps: [{ label: 'Down moves to a row', key: KEY.down }],
      linesBefore: 24,
      columns: 120,
      rows: 24,
    })

    await expect(screens).toMatchFileSnapshot('__screens__/bottom.txt')
    expect(selected).toStrictEqual([
      'actions/cache',
      'actions/setup-node',
      'aquasecurity/trivy-action',
    ])
  })

  it('says that every action is up to date when none has an update', async () => {
    let terminal = createFakeTerminal({ columns: 120, rows: 40 })
    let upToDate = createUpdates().filter(update => !update.hasUpdate)

    await expect(promptUpdateSelection(upToDate)).resolves.toBeNull()
    await terminal.settle()

    await expect(`${terminal.screen()}\n`).toMatchFileSnapshot(
      '__screens__/up-to-date.txt',
    )
  })
})
