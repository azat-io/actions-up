import type { IBufferCell, IBufferLine } from '@xterm/headless'
import type { MockInstance } from 'vitest'

import { PassThrough, Writable } from 'node:stream'
import { setInterval } from 'node:timers/promises'
import { onTestFinished, vi } from 'vitest'
import xterm from '@xterm/headless'
import { format } from 'node:util'

/**
 * How long the screen has to stay unchanged before it counts as settled, in
 * milliseconds.
 */
const SETTLE_DELAY = 20

/**
 * Names of the 16 basic foreground colors, by palette index, as picocolors
 * calls them.
 */
const FOREGROUND_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'gray',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
]

/**
 * Names of the 16 basic background colors, by palette index, as picocolors
 * calls them.
 */
const BACKGROUND_NAMES = [
  'bgBlack',
  'bgRed',
  'bgGreen',
  'bgYellow',
  'bgBlue',
  'bgMagenta',
  'bgCyan',
  'bgWhite',
  'bgBlackBright',
  'bgRedBright',
  'bgGreenBright',
  'bgYellowBright',
  'bgBlueBright',
  'bgMagentaBright',
  'bgCyanBright',
  'bgWhiteBright',
]

/**
 * Number of the DEC private mode that shows and hides the cursor.
 */
const CURSOR_VISIBILITY_MODE = 25

/**
 * Terminal that the code under test talks to instead of a real one.
 */
export interface FakeTerminal {
  /**
   * Type a key the way a terminal in raw mode sends it, such as `\u{1B}[B` for
   * Down, and wait until the screen settles.
   *
   * A lone Esc settles before the program reacts to it: readline waits for its
   * escape timeout, 500 ms by default, to tell Esc from the start of another
   * key.
   */
  press(key: string): Promise<void>

  /**
   * Wait until nothing is written to the screen for a while and everything
   * written is drawn.
   */
  settle(): Promise<void>

  /**
   * Text of the screen with the style of every run of characters and the lines
   * that scrolled off above it, under a header that says where the cursor is,
   * how many times it was shown after being hidden, and how many times the bell
   * rang.
   *
   * The position of the cursor counts even while it is hidden: when a signal
   * ends the program, the cursor shows up there and the shell goes on from it.
   */
  screen(): string
}

/**
 * Characters next to each other on a line that look the same.
 */
interface Run {
  /**
   * Background that a blank can share with the run, as named in `style`; null
   * when a blank would show more than its background, as with inverse video or
   * a line under, over or through it.
   */
  background: string | null

  /**
   * Names of the colors and attributes, empty for the default style, or null
   * for blanks, which show nothing but their background.
   */
  style: string | null

  /**
   * Characters of the run.
   */
  text: string
}

/**
 * Size of the fake terminal.
 */
interface TerminalSize {
  /**
   * Width of the screen in character cells.
   */
  columns: number

  /**
   * Height of the screen in lines.
   */
  rows: number
}

/**
 * Replace the terminal of the process with a fake one for the running test.
 *
 * `process.stdin` becomes a keyboard that sends what `press` types,
 * `process.stdout` and the console write to an emulated xterm screen, so the
 * code under test runs unchanged, the way it would in a real terminal. The
 * output gets the `\r\n` line endings a terminal driver adds. The original
 * streams and console come back when the test finishes.
 *
 * Limits:
 *
 * - It has to be called inside a test, and the tests that use it cannot run
 *   concurrently, because it replaces streams of the whole process.
 * - Timers have to stay real, because xterm draws on a timer: freeze the clock
 *   with `vi.setSystemTime()` or `vi.useFakeTimers({ toFake: ['Date'] })`.
 * - Only `process.stdin`, `process.stdout` and the console are faked, not
 *   `process.stderr`, `tty.isatty()`, the cursor methods of a TTY stream or
 *   resize events.
 *
 * @param size - Number of columns and rows of the screen.
 * @returns Controls to type keys and to read the screen.
 */
export function createFakeTerminal(size: TerminalSize): FakeTerminal {
  let terminal = new xterm.Terminal({
    allowProposedApi: true,
    cols: size.columns,
    scrollback: 1000,
    convertEol: true,
    rows: size.rows,
  })
  let spies: MockInstance[] = []

  onTestFinished(() => {
    for (let spy of spies) {
      spy.mockRestore()
    }
    terminal.dispose()
  })

  let isCursorHidden = false
  let cursorShowCount = 0
  let drawn = Promise.resolve()
  let writeCount = 0
  let bellCount = 0

  terminal.onBell(() => {
    bellCount += 1
  })
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, modes => {
    isCursorHidden ||= modes.includes(CURSOR_VISIBILITY_MODE)
    return false
  })
  terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, modes => {
    if (isCursorHidden && modes.includes(CURSOR_VISIBILITY_MODE)) {
      isCursorHidden = false
      cursorShowCount += 1
    }
    return false
  })

  /**
   * Send output to the emulated screen.
   *
   * @param data - Output, possibly with escape sequences; bytes are decoded as
   *   UTF-8 across writes, the way a terminal does.
   */
  function draw(data: Uint8Array | string): void {
    writeCount += 1
    drawn = new Promise(resolve => {
      terminal.write(data, resolve)
    })
  }

  let input = Object.assign(new PassThrough(), {
    setRawMode(this: { isRaw: boolean }, mode: boolean): void {
      this.isRaw = mode
    },
    isRaw: false,
    isTTY: true,
  })
  let output = Object.assign(
    new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        draw(chunk)
        callback()
      },
      decodeStrings: false,
    }),
    {
      getWindowSize: (): [number, number] => [size.columns, size.rows],
      columns: size.columns,
      rows: size.rows,
      isTTY: true,
    },
  )

  spies.push(
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as never),
    vi.spyOn(process, 'stdout', 'get').mockReturnValue(output as never),
    ...(['error', 'info', 'log', 'warn'] as const).map(method =>
      vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
        draw(`${format(...parts)}\n`)
      }),
    ),
  )

  /**
   * Wait until nothing is written for `SETTLE_DELAY` milliseconds, then until
   * the screen shows everything written.
   *
   * @returns Resolves once the screen has settled.
   */
  async function settle(): Promise<void> {
    let writesBefore = writeCount
    for await (let _tick of setInterval(SETTLE_DELAY)) {
      if (writeCount === writesBefore) {
        break
      }
      writesBefore = writeCount
    }
    await drawn
  }

  return {
    screen() {
      let buffer = terminal.buffer.active
      let cell = buffer.getNullCell()
      let lines: string[] = []
      for (let index = 0; index < buffer.length; index++) {
        lines.push(renderLine(buffer.getLine(index)!, cell))
      }
      let scrollback = lines.slice(0, buffer.baseY)
      let visible = lines.slice(buffer.baseY)
      while (visible.at(-1) === '') {
        visible.pop()
      }
      let visibility = isCursorHidden ? 'hidden' : 'visible'
      return [
        `cursor: ${visibility}, row ${buffer.cursorY + 1}, column ${buffer.cursorX + 1}`,
        `times the cursor was shown: ${cursorShowCount}`,
        `bells: ${bellCount}`,
        ...(scrollback.length > 0 ? ['--- scrollback ---', ...scrollback] : []),
        '--- screen ---',
        ...visible,
      ].join('\n')
    },
    async press(key) {
      input.write(key)
      await settle()
    },
    settle,
  }
}

/**
 * Name the style of a cell after the picocolors functions that produce it, such
 * as `gray bgBlack` or `dim`.
 *
 * @param cell - Cell to describe.
 * @returns Space separated names, empty for the default style.
 */
function nameStyle(cell: IBufferCell): string {
  let names = [
    nameColor(cell.isFgDefault(), cell.isFgRGB(), {
      palette: FOREGROUND_NAMES,
      value: cell.getFgColor(),
      prefix: '',
    }),
    nameColor(cell.isBgDefault(), cell.isBgRGB(), {
      palette: BACKGROUND_NAMES,
      value: cell.getBgColor(),
      prefix: 'bg',
    }),
  ]
  /**
   * Attributes in the order of their SGR codes.
   */
  let attributes: [name: string, value: number][] = [
    ['bold', cell.isBold()],
    ['dim', cell.isDim()],
    ['italic', cell.isItalic()],
    ['underline', cell.isUnderline()],
    ['blink', cell.isBlink()],
    ['inverse', cell.isInverse()],
    ['hidden', cell.isInvisible()],
    ['strikethrough', cell.isStrikethrough()],
    ['overline', cell.isOverline()],
  ]
  for (let [name, value] of attributes) {
    if (value !== 0) {
      names.push(name)
    }
  }
  return names.filter(name => name !== '').join(' ')
}

/**
 * Render a line of the screen as text in which every run of characters with a
 * style other than the default one is written as `{style:text}`, without the
 * blank cells at its end.
 *
 * Only what can be seen counts. A blank shows nothing but its background, so
 * its color and attributes such as bold make no difference: blanks take the
 * style of the characters around them when both sides share it and its
 * background, and are named after their background otherwise.
 *
 * @param line - Line of the screen.
 * @param cell - Cell object to reuse while reading the line.
 * @returns Text of the line.
 */
function renderLine(line: IBufferLine, cell: IBufferCell): string {
  let runs: Run[] = []
  for (let column = 0; column < line.length; column++) {
    line.getCell(column, cell)
    if (cell.getWidth() > 0) {
      appendToRuns(runs, describeCell(cell))
    }
  }
  let last = runs.at(-1)
  if (last?.style === null && last.background === '') {
    runs.pop()
  }

  let resolved: Run[] = []
  for (let [index, run] of runs.entries()) {
    appendToRuns(resolved, {
      style: run.style ?? styleBlank(run, runs[index - 1], runs[index + 1]),
      background: null,
      text: run.text,
    })
  }
  return resolved
    .map(({ style, text }) => (style ? `{${style}:${text}}` : text))
    .join('')
}

/**
 * Describe the look of a cell.
 *
 * @param cell - Cell to describe.
 * @returns Run of the one character of the cell.
 */
function describeCell(cell: IBufferCell): Run {
  let text = cell.getChars() || ' '
  let showsMoreThanBackground =
    cell.isInverse() !== 0 ||
    cell.isUnderline() !== 0 ||
    cell.isStrikethrough() !== 0 ||
    cell.isOverline() !== 0
  let background =
    showsMoreThanBackground ? null : (
      nameColor(cell.isBgDefault(), cell.isBgRGB(), {
        palette: BACKGROUND_NAMES,
        value: cell.getBgColor(),
        prefix: 'bg',
      })
    )
  if (text === ' ' && background !== null) {
    return { style: null, background, text }
  }
  return { style: nameStyle(cell), background, text }
}

/**
 * Name a foreground or background color.
 *
 * @param isDefault - Whether the cell uses the default color of the terminal.
 * @param isRgb - Whether the color is a 24-bit one.
 * @param color - The color and how to name it.
 * @param color.value - Palette index or 24-bit value.
 * @param color.palette - Names of the 16 basic colors.
 * @param color.prefix - Prefix of the names of the other colors.
 * @returns Name of the color, empty for the default one.
 */
function nameColor(
  isDefault: boolean,
  isRgb: boolean,
  color: { palette: string[]; prefix: string; value: number },
): string {
  if (isDefault) {
    return ''
  }
  if (isRgb) {
    return `${color.prefix}#${color.value.toString(16).padStart(6, '0')}`
  }
  return color.palette[color.value] ?? `${color.prefix}color${color.value}`
}

/**
 * Pick the style a run of blanks is written with.
 *
 * @param blank - Run of blanks.
 * @param before - Run on its left, if any.
 * @param after - Run on its right, if any.
 * @returns Style of the runs around the blanks when both share it and the
 *   background of the blanks, otherwise the name of that background.
 */
function styleBlank(
  blank: Run,
  before: undefined | Run,
  after: undefined | Run,
): string {
  let isSurrounded =
    before?.style === after?.style && before?.background === blank.background
  return (isSurrounded ? before?.style : null) ?? blank.background ?? ''
}

/**
 * Add characters to the end of a line, joining them to the last run when they
 * look the same.
 *
 * @param runs - Runs of the line so far, changed in place.
 * @param run - Characters to add.
 */
function appendToRuns(runs: Run[], run: Run): void {
  let last = runs.at(-1)
  if (last?.style === run.style && last.background === run.background) {
    last.text += run.text
  } else {
    runs.push({ ...run })
  }
}
