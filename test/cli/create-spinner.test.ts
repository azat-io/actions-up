import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { isInteractiveTerminal } from '../../cli/is-interactive-terminal'
import { isUnicodeSupported } from '../../cli/is-unicode-supported'
import { createSpinner } from '../../cli/create-spinner'
import { colors } from '../../core/interactive/colors'

vi.mock(import('../../cli/is-interactive-terminal'))
vi.mock(import('../../cli/is-unicode-supported'))

/**
 * The colors module decides at import time whether to color, from the
 * environment and the terminal. Colors turned on let every test check the same
 * output everywhere.
 */
vi.mock(import('../../core/interactive/colors'), async importOriginal => {
  let actual = await importOriginal()
  return { ...actual, colors: actual.createColors(true) }
})

/**
 * Hides the cursor.
 */
const HIDE_CURSOR = '\u{1B}[?25l'

/**
 * Shows the cursor.
 */
const SHOW_CURSOR = '\u{1B}[?25h'

/**
 * Moves the cursor to the first column.
 */
const LINE_START = '\u{1B}[1G'

/**
 * Erases the row and moves the cursor to its first column.
 */
const ERASE_LINE = '\u{1B}[2K\u{1B}[1G'

/**
 * Moves the cursor one row up.
 */
const MOVE_UP = '\u{1B}[1A'

/**
 * Real descriptor of the width of standard error, restored after every test.
 */
let realColumns = Object.getOwnPropertyDescriptor(process.stderr, 'columns')

/**
 * Set the width standard error reports.
 *
 * @param columns - Width to report, or undefined for none.
 */
function setColumns(columns: undefined | number): void {
  Object.defineProperty(process.stderr, 'columns', {
    configurable: true,
    value: columns,
  })
}

describe('createSpinner', () => {
  let writeSpy: MockInstance<typeof process.stderr.write>
  let exitSpy: MockInstance<typeof process.exit>
  let onSpy: MockInstance<typeof process.on>

  /**
   * Everything written to standard error since the last check.
   *
   * @returns Output, and nothing for the next call.
   */
  function takeOutput(): string {
    let output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('')
    writeSpy.mockClear()
    return output
  }

  /**
   * Send a signal to the listener the spinner registered for it.
   *
   * @param signal - Signal to send.
   */
  function sendSignal(signal: NodeJS.Signals): void {
    let [, listener] = onSpy.mock.calls.find(([event]) => event === signal)!
    listener(signal)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(isInteractiveTerminal).mockReturnValue(true)
    vi.mocked(isUnicodeSupported).mockReturnValue(true)
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    onSpy = vi.spyOn(process, 'on')
    setColumns(80)
  })

  afterEach(() => {
    if (realColumns) {
      Object.defineProperty(process.stderr, 'columns', realColumns)
    } else {
      Reflect.deleteProperty(process.stderr, 'columns')
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('draws the first frame with the cursor hidden', () => {
    let spinner = createSpinner('Scanning GitHub Actions...').start()

    expect(takeOutput()).toBe(
      `${HIDE_CURSOR}${LINE_START}${colors.yellow('⠋')} Scanning GitHub Actions...`,
    )

    spinner.success('Done')
  })

  it('redraws its row every 50 ms with the next frame, over and over', () => {
    let spinner = createSpinner('Scanning GitHub Actions...').start()
    takeOutput()

    vi.advanceTimersByTime(500)

    expect(takeOutput()).toBe(
      [...'⠙⠹⠸⠼⠴⠦⠧⠇⠏⠋']
        .map(
          frame =>
            `${HIDE_CURSOR}${LINE_START}${ERASE_LINE}${colors.yellow(frame)} Scanning GitHub Actions...`,
        )
        .join(''),
    )

    spinner.success('Done')
  })

  it('replaces the frame with a green success line and stops', () => {
    let spinner = createSpinner('Checking for updates...').start()
    takeOutput()

    spinner.success('All actions are up to date!')
    vi.advanceTimersByTime(500)

    expect(takeOutput()).toBe(
      `${LINE_START}${ERASE_LINE}${colors.green('✔')} All actions are up to date!\n${SHOW_CURSOR}`,
    )
  })

  it('replaces the frame with a red failure line and stops', () => {
    let spinner = createSpinner('Checking for updates...').start()
    takeOutput()

    spinner.error('Failed')
    vi.advanceTimersByTime(500)

    expect(takeOutput()).toBe(
      `${LINE_START}${ERASE_LINE}${colors.red('✖')} Failed\n${SHOW_CURSOR}`,
    )
  })

  it('prints a failure line after the success line of a stopped spinner', () => {
    let spinner = createSpinner('Checking for updates...').start()
    spinner.success('Found 1 update available')
    takeOutput()

    spinner.error('Failed')

    expect(takeOutput()).toBe(
      `${LINE_START}${colors.red('✖')} Failed\n${SHOW_CURSOR}`,
    )
  })

  it('uses ASCII frames and marks when the terminal cannot show Unicode', () => {
    vi.mocked(isUnicodeSupported).mockReturnValue(false)

    let scanning = createSpinner('Scanning GitHub Actions...').start()
    vi.advanceTimersByTime(150)
    scanning.success('one')
    createSpinner('Checking for updates...').start().error('two')

    expect(takeOutput()).toBe(
      [
        `${HIDE_CURSOR}${LINE_START}${colors.yellow('-')} Scanning GitHub Actions...`,
        `${HIDE_CURSOR}${LINE_START}${ERASE_LINE}${colors.yellow('\\')} Scanning GitHub Actions...`,
        `${HIDE_CURSOR}${LINE_START}${ERASE_LINE}${colors.yellow('|')} Scanning GitHub Actions...`,
        `${HIDE_CURSOR}${LINE_START}${ERASE_LINE}${colors.yellow('/')} Scanning GitHub Actions...`,
        `${LINE_START}${ERASE_LINE}${colors.green('√')} one\n${SHOW_CURSOR}`,
        `${HIDE_CURSOR}${LINE_START}${colors.yellow('-')} Checking for updates...`,
        `${LINE_START}${ERASE_LINE}${colors.red('×')} two\n${SHOW_CURSOR}`,
      ].join(''),
    )
  })

  it('erases every row of a frame that a narrow terminal wraps', () => {
    setColumns(20)

    let spinner = createSpinner('Scanning GitHub Actions...').start()
    takeOutput()
    vi.advanceTimersByTime(50)

    expect(takeOutput()).toBe(
      `${HIDE_CURSOR}${LINE_START}${ERASE_LINE}${MOVE_UP}${ERASE_LINE}${colors.yellow('⠙')} Scanning GitHub Actions...`,
    )

    spinner.success('Done')
  })

  it.each([
    { description: 'reports no width', columns: undefined },
    { description: 'reports no columns', columns: 0 },
  ])('assumes 80 columns when standard error $description', ({ columns }) => {
    setColumns(columns)

    let spinner = createSpinner('x'.repeat(80)).start()
    takeOutput()
    spinner.success('Done')

    expect(takeOutput()).toBe(
      `${LINE_START}${ERASE_LINE}${MOVE_UP}${ERASE_LINE}${colors.green('✔')} Done\n${SHOW_CURSOR}`,
    )
  })

  it('prints its text once and the final line outside an interactive terminal', () => {
    vi.mocked(isInteractiveTerminal).mockReturnValue(false)

    let spinner = createSpinner('Scanning GitHub Actions...').start()
    vi.advanceTimersByTime(500)
    spinner.success('Found 1 action')

    expect(takeOutput()).toBe(
      `${colors.yellow('-')} Scanning GitHub Actions...\n${colors.green('✔')} Found 1 action\n`,
    )
  })

  it('listens to SIGINT and SIGTERM only while it runs', () => {
    let interrupts = process.listenerCount('SIGINT')
    let terminations = process.listenerCount('SIGTERM')

    let spinner = createSpinner('Checking for updates...').start()

    expect(process.listenerCount('SIGINT')).toBe(interrupts + 1)
    expect(process.listenerCount('SIGTERM')).toBe(terminations + 1)

    spinner.success('Done')

    expect(process.listenerCount('SIGINT')).toBe(interrupts)
    expect(process.listenerCount('SIGTERM')).toBe(terminations)
  })

  it('erases the frame, shows the cursor and exits with 130 on SIGINT', () => {
    let interrupts = process.listenerCount('SIGINT')
    let terminations = process.listenerCount('SIGTERM')
    createSpinner('Checking for updates...').start()
    takeOutput()

    sendSignal('SIGINT')
    vi.advanceTimersByTime(500)

    expect(takeOutput()).toBe(`${LINE_START}${ERASE_LINE}${SHOW_CURSOR}`)
    expect(exitSpy).toHaveBeenCalledExactlyOnceWith(130)
    expect(process.listenerCount('SIGINT')).toBe(interrupts)
    expect(process.listenerCount('SIGTERM')).toBe(terminations)
  })

  it('exits with 143 on SIGTERM, without output outside an interactive terminal', () => {
    vi.mocked(isInteractiveTerminal).mockReturnValue(false)
    createSpinner('Checking for updates...').start()
    takeOutput()

    sendSignal('SIGTERM')

    expect(takeOutput()).toBe('')
    expect(exitSpy).toHaveBeenCalledExactlyOnceWith(143)
  })
})
