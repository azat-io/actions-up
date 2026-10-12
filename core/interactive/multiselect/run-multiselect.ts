import type { Key } from 'node:readline'

import { emitKeypressEvents } from 'node:readline'

import type { MultiselectEntry } from '../../../types/multiselect-entry'

import { createMultiselectState } from './create-multiselect-state'
import { reduceMultiselectKey } from './reduce-multiselect-key'
import { getSelectedValues } from './get-selected-values'
import { renderMultiselect } from './render-multiselect'
import { countScreenRows } from './count-screen-rows'
import { stripAnsi } from '../strip-ansi'

/**
 * Hides the cursor while the prompt is open.
 */
const HIDE_CURSOR = '\u{1B}[?25l'

/**
 * Shows the cursor again.
 */
const SHOW_CURSOR = '\u{1B}[?25h'

/**
 * Rings the bell of the terminal.
 */
const BELL = '\u{7}'

/**
 * Width assumed when the terminal does not report one.
 */
const DEFAULT_COLUMNS = 80

/**
 * Height assumed when the terminal does not report one.
 */
const DEFAULT_ROWS = 25

/**
 * Signals that end the process while the prompt is open, with the exit codes a
 * shell reports for them.
 */
const SIGNAL_EXIT_CODES: [signal: NodeJS.Signals, code: number][] = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]

/**
 * What to show in a multiselect prompt.
 */
interface RunMultiselectOptions<Value> {
  /**
   * Describe the submitted selection after the question, or return an empty
   * string to say that nothing was selected.
   *
   * @param values - Values of the selected options, in the order of the list.
   * @returns Text after the question.
   */
  summarize(values: Value[]): string

  /**
   * Lines of the list, top to bottom.
   */
  entries: MultiselectEntry<Value>[]

  /**
   * Question on the first line, possibly colored.
   */
  message: string

  /**
   * Line under the list, after a blank line.
   */
  footer: string
}

/**
 * Standard output, with the parts a terminal adds.
 */
interface TerminalOutput {
  /**
   * Report the width and the height of the terminal.
   */
  getWindowSize?(): [columns: number, rows: number]

  /**
   * Write text to the terminal.
   */
  write(text: string): unknown

  /**
   * Width of the terminal.
   */
  columns?: number

  /**
   * Height of the terminal.
   */
  rows?: number
}

/**
 * Show a multiselect prompt on standard output and let the user choose with the
 * keyboard on standard input.
 *
 * It writes to the terminal what enquirer 2.4.1 wrote, so the prompt looks and
 * behaves the same: it hides the cursor, redraws the frame in place after every
 * key with relative cursor moves, rings the bell on keys it does not use, and
 * once closed leaves only the question with the summary of the selection. Esc
 * cancels after readline's escape timeout of 500 ms, like before. Unlike
 * enquirer, it gives raw mode back as it found it, and assumes 80 columns and
 * 25 rows when the terminal reports no size. While it is open, SIGINT and
 * SIGTERM show the cursor and end the process with the exit code a shell
 * reports for them.
 *
 * @param options - What to show.
 * @returns Values of the selected options once submitted, or null once
 *   cancelled.
 */
export function runMultiselect<Value>(
  options: RunMultiselectOptions<Value>,
): Promise<Value[] | null> {
  let input = process.stdin
  let output: TerminalOutput = process.stdout
  let isWindows = process.platform === 'win32'
  let isWindowsConsole = isWindows && process.env['TERM_PROGRAM'] !== 'Hyper'
  let wasRaw = input.isRaw
  let state = createMultiselectState(options.entries)
  let isCursorHidden = true
  let lastFrame = ''
  let movedUp = 0
  let start = 0
  let processListeners: [event: string, listener: () => void][] = []

  /**
   * Show the cursor, unless it is shown already.
   */
  function showCursor(): void {
    if (isCursorHidden) {
      isCursorHidden = false
      output.write(SHOW_CURSOR)
    }
  }

  /**
   * Erase the last frame and draw the current state in its place, then move the
   * cursor back up to the question.
   */
  function draw(): void {
    let { columns, rows } = getTerminalSize(output, isWindows)
    let frame = renderMultiselect(state, {
      summarize: options.summarize,
      message: options.message,
      footer: options.footer,
      isWindowsConsole,
      columns,
      start,
      rows,
    })
    if (lastFrame !== '') {
      output.write(`\u{1B}[${movedUp}B${eraseFrame(lastFrame, columns)}`)
    }
    output.write(frame.text)
    ;({ text: lastFrame, start } = frame)

    let [first = '', ...rest] = stripAnsi(frame.text).split('\n')
    movedUp = rest.length
    if (movedUp > 0) {
      output.write(`\u{1B}[${movedUp}A\u{1B}[${countCursorColumns(first) + 1}G`)
    } else {
      let summary = first.slice(stripAnsi(frame.prompt).length + 1)
      output.write(`\u{1B}[${countCursorColumns(summary)}D`)
    }
  }

  return new Promise(resolve => {
    /**
     * Apply a key and close the prompt once it is submitted or cancelled.
     *
     * @param _text - Text of the key.
     * @param key - The key, as readline reports it.
     */
    function onKeypress(_text: undefined | string, key: Key): void {
      let next = reduceMultiselectKey(state, key)
      if (!next) {
        output.write(BELL)
        return
      }
      state = next
      draw()
      if (state.status === 'pending') {
        return
      }

      let { columns } = getTerminalSize(output, isWindows)
      let [first = ''] = stripAnsi(lastFrame).split('\n', 1)
      output.write('\n'.repeat(Math.ceil(first.length / columns)))
      showCursor()
      if (input.isTTY) {
        input.setRawMode(wasRaw)
      }
      input.off('keypress', onKeypress)
      input.pause()
      for (let [event, listener] of processListeners) {
        process.off(event, listener)
      }
      resolve(state.status === 'submitted' ? getSelectedValues(state) : null)
    }

    for (let [signal, code] of SIGNAL_EXIT_CODES) {
      let listener: () => void
      /**
       * The listener is written right in the call: unicorn/no-process-exit
       * allows `process.exit()` only in a handler passed to `process.on()`.
       */
      process.on(
        signal,
        (listener = () => {
          showCursor()
          process.exit(code)
        }),
      )
      processListeners.push([signal, listener])
    }
    process.on('exit', showCursor)
    processListeners.push(['exit', showCursor])

    emitKeypressEvents(input)
    if (input.isTTY) {
      input.setRawMode(true)
    }
    input.on('keypress', onKeypress)
    input.resume()

    output.write(HIDE_CURSOR)
    draw()
  })
}

/**
 * Read the size of the terminal, the way enquirer did: a Windows console leaves
 * its last column unused. A terminal that reports no size counts as 80 columns
 * and 25 rows, and at least one column is always left to draw in.
 *
 * @param output - Standard output.
 * @param isWindows - Whether the process runs on Windows.
 * @returns Width and height to draw in.
 */
function getTerminalSize(
  output: TerminalOutput,
  isWindows: boolean,
): { columns: number; rows: number } {
  let [columns, rows] = output.getWindowSize?.() ?? [
    output.columns,
    output.rows,
  ]
  let width = isPositive(columns) ? columns : DEFAULT_COLUMNS
  return {
    columns: Math.max(isWindows ? width - 1 : width, 1),
    rows: isPositive(rows) ? rows : DEFAULT_ROWS,
  }
}

/**
 * Build the sequence that erases every row of the screen a frame took, from its
 * last row up, and leaves the cursor at the start of its first row.
 *
 * @param frame - Text of the frame.
 * @param columns - Width of the terminal.
 * @returns Escape sequence.
 */
function eraseFrame(frame: string, columns: number): string {
  let rows = 0
  for (let line of frame.split(/\r?\n/u)) {
    rows += countScreenRows(line, columns)
  }
  return `${'\u{1B}[2K\u{1B}[F'.repeat(rows - 1)}\u{1B}[2K\u{1B}[1G`
}

/**
 * Count the columns enquirer moved the cursor by for a text: one for a
 * character up to code 128, two for any other, so `…` counts as two.
 *
 * @param text - Text without colors.
 * @returns Number of columns.
 */
function countCursorColumns(text: string): number {
  let columns = 0
  for (let index = 0; index < text.length; index++) {
    columns += text.charCodeAt(index) <= 128 ? 1 : 2
  }
  return columns
}

/**
 * Check whether a size the terminal reports is usable: a terminal created
 * without a size reports zero.
 *
 * @param size - Width or height, if any.
 * @returns True for a number above zero.
 */
function isPositive(size: undefined | number): size is number {
  return size !== undefined && size > 0
}
