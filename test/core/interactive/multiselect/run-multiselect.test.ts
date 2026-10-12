import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { MultiselectEntry } from '../../../../types/multiselect-entry'
import type { FakeTerminal } from '../../../helpers/create-fake-terminal'

import { runMultiselect } from '../../../../core/interactive/multiselect/run-multiselect'
import { createFakeTerminal } from '../../../helpers/create-fake-terminal'

/**
 * The colors module decides at import time whether to color, from the
 * environment and the terminal. Colors turned on let every test check the same
 * output everywhere.
 */
vi.mock(import('../../../../core/interactive/colors'), async importOriginal => {
  let actual = await importOriginal()
  return { ...actual, colors: actual.createColors(true) }
})

/**
 * Keys as a terminal in raw mode sends them.
 */
const KEY = {
  escape: '\u{1B}',
  down: '\u{1B}[B',
  left: '\u{1B}[D',
  end: '\u{1B}[F',
  up: '\u{1B}[A',
  ctrlC: '\u{3}',
  enter: '\r',
  space: ' ',
}

/**
 * Size of the terminal in most tests.
 */
const SIZE = { columns: 40, rows: 12 }

/**
 * Real descriptor of the platform, restored after every test.
 */
let realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

/**
 * Two groups separated by a blank line; the second one has a disabled option.
 *
 * @returns Lines of the list.
 */
function createEntries(): MultiselectEntry<string>[] {
  return [
    { message: 'a.yml', kind: 'group' },
    option('one', { selected: true }),
    option('two'),
    { kind: 'separator', message: ' ' },
    { message: 'b.yml', kind: 'group' },
    option('three', { selected: true }),
    option('four', { disabled: true }),
  ]
}

/**
 * Option of the list whose value is its text.
 *
 * @param message - Text of the option.
 * @param flags - Whether it is selected at the start and whether it is
 *   disabled.
 * @returns Line of the list.
 */
function option(
  message: string,
  flags: { selected?: boolean; disabled?: boolean } = {},
): MultiselectEntry<string> {
  return {
    disabled: flags.disabled ?? false,
    selected: flags.selected ?? false,
    kind: 'option',
    value: message,
    message,
  }
}

/**
 * Visible text of the lines on the screen, without styles.
 *
 * @param terminal - Terminal the prompt runs in.
 * @returns Lines below the header of the screen.
 */
function screenLines(terminal: FakeTerminal): string[] {
  let screen = terminal.screen()
  return screen
    .slice(screen.indexOf('--- screen ---\n') + '--- screen ---\n'.length)
    .replaceAll(/\{[\w #]+:(?<text>[^}]*)\}/gu, '$<text>')
    .split('\n')
}

/**
 * Open the prompt.
 *
 * @param entries - Lines of the list.
 * @returns What the prompt resolves with.
 */
function open(entries = createEntries()): Promise<string[] | null> {
  return runMultiselect({
    summarize: values => (values.length > 0 ? `${values.length} picked` : ''),
    footer: 'Enter to submit.',
    message: 'Pick',
    entries,
  })
}

/**
 * A group with many options, more than a small terminal shows at once.
 *
 * @param count - Number of options.
 * @returns Lines of the list.
 */
function createLongEntries(count: number): MultiselectEntry<string>[] {
  return [
    { message: 'a.yml', kind: 'group' },
    ...Array.from({ length: count }, (_, index) => option(`option ${index}`)),
  ]
}

/**
 * Listeners the process has for the events a prompt has to clean up after.
 *
 * @returns Number of listeners by event.
 */
function countProcessListeners(): Record<string, number> {
  return Object.fromEntries(
    ['SIGINT', 'SIGTERM', 'exit'].map(event => [
      event,
      process.listenerCount(event),
    ]),
  )
}

/**
 * Line of the screen header that says where the cursor is.
 *
 * @param terminal - Terminal the prompt runs in.
 * @returns Visibility, row and column of the cursor.
 */
function cursorLine(terminal: FakeTerminal): string {
  return terminal.screen().split('\n', 1)[0]!
}

describe('runMultiselect', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('draws the question, the list and the footer below the earlier output', async () => {
    let terminal = createFakeTerminal(SIZE)
    console.info('Earlier output')
    let selection = open()
    await terminal.settle()

    expect(screenLines(terminal)).toStrictEqual([
      'Earlier output',
      '? Pick …',
      '❯ ○ a.yml',
      '    ● one',
      '    ○ two',
      '',
      '  ○ b.yml',
      '    ● three',
      '    ○ four (disabled)',
      '',
      'Enter to submit.',
    ])
    expect(cursorLine(terminal)).toBe('cursor: hidden, row 2, column 11')

    await terminal.press(KEY.ctrlC)
    await selection
  })

  it('redraws the frame in place after every key', async () => {
    let terminal = createFakeTerminal(SIZE)
    let selection = open()
    await terminal.settle()

    await terminal.press(KEY.down)
    await terminal.press(KEY.down)

    expect(screenLines(terminal)).toStrictEqual([
      '? Pick …',
      '  ○ a.yml',
      '    ● one',
      '❯   ○ two',
      '',
      '  ○ b.yml',
      '    ● three',
      '    ○ four (disabled)',
      '',
      'Enter to submit.',
    ])

    await terminal.press(KEY.ctrlC)
    await selection
  })

  it('returns the values of the selected options on Enter and leaves the summary', async () => {
    let terminal = createFakeTerminal(SIZE)
    console.info('Earlier output')
    let selection = open()
    await terminal.settle()

    await terminal.press(KEY.down)
    await terminal.press(KEY.space)
    await terminal.press(KEY.enter)

    await expect(selection).resolves.toStrictEqual(['three'])
    await terminal.settle()
    expect(screenLines(terminal)).toStrictEqual([
      'Earlier output',
      '✔ Pick · 1 picked',
    ])
    expect(cursorLine(terminal)).toBe('cursor: visible, row 3, column 1')
  })

  it.each([
    { name: 'Ctrl+C', key: KEY.ctrlC },
    { key: KEY.escape, name: 'Esc' },
  ])(
    'returns null on $name and says that nothing was selected',
    async ({ key }) => {
      let terminal = createFakeTerminal(SIZE)
      let selection = open()
      await terminal.settle()

      await terminal.press(key)

      await expect(selection).resolves.toBeNull()
      await terminal.settle()
      expect(screenLines(terminal)).toStrictEqual([
        '✖ Pick · No items were selected',
      ])
    },
  )

  it('rings the bell on a key it does not use and leaves the frame as it was', async () => {
    let terminal = createFakeTerminal(SIZE)
    let selection = open()
    await terminal.settle()
    let before = screenLines(terminal)

    await terminal.press(KEY.left)

    expect(terminal.screen()).toContain('bells: 1')
    expect(screenLines(terminal)).toStrictEqual(before)

    await terminal.press(KEY.ctrlC)
    await selection
  })

  it('turns raw mode on while it is open and off once it closes', async () => {
    let terminal = createFakeTerminal(SIZE)
    let selection = open()

    expect(process.stdin.isRaw).toBeTruthy()

    await terminal.press(KEY.ctrlC)
    await selection

    expect(process.stdin.isRaw).toBeFalsy()
  })

  it('leaves raw mode on when it was on before', async () => {
    let terminal = createFakeTerminal(SIZE)
    process.stdin.setRawMode(true)
    let selection = open()

    await terminal.press(KEY.ctrlC)
    await selection

    expect(process.stdin.isRaw).toBeTruthy()
  })

  it('reads the keys of a keyboard that is not a terminal without raw mode', async () => {
    let terminal = createFakeTerminal(SIZE)
    Object.assign(process.stdin, { isTTY: false })
    let setRawMode = vi.spyOn(process.stdin, 'setRawMode')
    let selection = open()

    await terminal.press(KEY.enter)

    await expect(selection).resolves.toStrictEqual(['one', 'three'])
    expect(setRawMode).not.toHaveBeenCalled()
  })

  it('stops reading the keyboard and listening to the process once it closes', async () => {
    let terminal = createFakeTerminal(SIZE)
    let before = countProcessListeners()
    let selection = open()

    expect(countProcessListeners()).toStrictEqual({
      SIGTERM: before['SIGTERM']! + 1,
      SIGINT: before['SIGINT']! + 1,
      exit: before['exit']! + 1,
    })

    await terminal.press(KEY.enter)
    await selection

    expect(countProcessListeners()).toStrictEqual(before)
    expect(process.stdin.listenerCount('keypress')).toBe(0)
    expect(process.stdin.isPaused()).toBeTruthy()
  })

  describe('when the process ends while it is open', () => {
    let onSpy: MockInstance<typeof process.on>
    let exitSpy: MockInstance<typeof process.exit>

    beforeEach(() => {
      onSpy = vi.spyOn(process, 'on')
      exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never)
    })

    /**
     * Call the listener the prompt registered for an event of the process.
     *
     * @param event - Name of the event.
     */
    function emitToPrompt(event: string): void {
      let [, listener] = onSpy.mock.calls.findLast(([name]) => name === event)!
      ;(listener as () => void)()
    }

    it.each([
      { signal: 'SIGINT', code: 130 },
      { signal: 'SIGTERM', code: 143 },
    ])(
      'shows the cursor and exits with $code on $signal',
      async ({ signal, code }) => {
        let terminal = createFakeTerminal(SIZE)
        let selection = open()
        await terminal.settle()

        emitToPrompt(signal)
        await terminal.settle()

        expect(cursorLine(terminal)).toMatch(/^cursor: visible/u)
        expect(exitSpy).toHaveBeenCalledExactlyOnceWith(code)

        await terminal.press(KEY.ctrlC)
        await selection
      },
    )

    it('shows the cursor once when the process exits', async () => {
      let terminal = createFakeTerminal(SIZE)
      let selection = open()
      await terminal.settle()

      emitToPrompt('exit')
      emitToPrompt('SIGINT')
      await terminal.settle()

      expect(terminal.screen()).toContain('times the cursor was shown: 1')
      expect(exitSpy).toHaveBeenCalledExactlyOnceWith(130)

      await terminal.press(KEY.ctrlC)
      await selection
    })
  })

  it.each([
    {
      output: { getWindowSize: (): [number, number] => [0, 0] },
      description: 'a terminal that reports no size',
    },
    {
      output: { getWindowSize: undefined, columns: undefined, rows: undefined },
      description: 'output that is not a terminal',
    },
  ])('assumes 80 columns and 25 rows for $description', async ({ output }) => {
    let terminal = createFakeTerminal({ columns: 100, rows: 40 })
    Object.assign(process.stdout, output)
    let selection = open(createLongEntries(40))
    await terminal.settle()

    expect(screenLines(terminal)).toHaveLength(25)

    await terminal.press(KEY.ctrlC)
    await selection
  })

  it('shows a window of a list taller than the terminal that follows the focus', async () => {
    let terminal = createFakeTerminal(SIZE)
    let selection = open(createLongEntries(20))
    await terminal.settle()

    await terminal.press(KEY.end)
    await terminal.press(KEY.up)

    expect(screenLines(terminal)).toStrictEqual([
      '? Pick …',
      '    ○ option 11',
      '    ○ option 12',
      '    ○ option 13',
      '    ○ option 14',
      '    ○ option 15',
      '    ○ option 16',
      '    ○ option 17',
      '❯   ○ option 18',
      '    ○ option 19',
      '',
      'Enter to submit.',
    ])

    await terminal.press(KEY.ctrlC)
    await selection
  })

  it('draws the symbols of Windows in a Windows console', async () => {
    let terminal = createFakeTerminal(SIZE)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.stubEnv('TERM_PROGRAM', undefined)
    let selection = open()
    await terminal.settle()

    expect(screenLines(terminal)[0]).toBe('? Pick ...')

    await terminal.press(KEY.enter)
    await selection
    await terminal.settle()

    expect(screenLines(terminal)[0]).toBe('√ Pick · 2 picked')
  })

  it('draws and closes in a Windows console one column wide', async () => {
    let terminal = createFakeTerminal(SIZE)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.assign(process.stdout, {
      getWindowSize: (): [number, number] => [1, SIZE.rows],
    })
    let selection = open()
    await terminal.settle()

    await terminal.press(KEY.down)
    await terminal.press(KEY.enter)

    await expect(selection).resolves.toStrictEqual(['one', 'three'])
  })

  it('keeps the usual symbols in Hyper on Windows', async () => {
    let terminal = createFakeTerminal(SIZE)
    Object.defineProperty(process, 'platform', { value: 'win32' })
    vi.stubEnv('TERM_PROGRAM', 'Hyper')
    let selection = open()
    await terminal.settle()

    expect(screenLines(terminal)[0]).toBe('? Pick …')

    await terminal.press(KEY.ctrlC)
    await selection
  })
})
