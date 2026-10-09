import { isInteractiveTerminal } from './is-interactive-terminal'
import { isUnicodeSupported } from './is-unicode-supported'
import { countTerminalRows } from './count-terminal-rows'
import { colors } from '../core/interactive/colors'

/**
 * Delay between two frames of the animation, in milliseconds.
 */
const FRAME_INTERVAL = 50

/**
 * Frames of the animation in a terminal that shows Unicode.
 */
const UNICODE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/**
 * Frames of the animation in a terminal limited to ASCII.
 */
const ASCII_FRAMES = ['-', '\\', '|', '/']

/**
 * The only frame outside an interactive terminal, printed once.
 */
const STATIC_FRAMES = ['-']

/**
 * Hides the cursor while the spinner animates.
 */
const HIDE_CURSOR = '\u{1B}[?25l'

/**
 * Shows the cursor again once the spinner stops.
 */
const SHOW_CURSOR = '\u{1B}[?25h'

/**
 * Moves the cursor to the first column of its row.
 */
const MOVE_TO_LINE_START = '\u{1B}[1G'

/**
 * Erases the row of the cursor and moves the cursor to its first column.
 */
const ERASE_LINE = '\u{1B}[2K\u{1B}[1G'

/**
 * Moves the cursor one row up.
 */
const MOVE_UP = '\u{1B}[1A'

/**
 * Signals that end the process while the spinner runs, with the exit codes a
 * shell reports for them.
 */
const SIGNAL_EXIT_CODES: [signal: NodeJS.Signals, code: number][] = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]

/**
 * Progress indicator shown while the CLI scans files and checks for updates.
 */
export interface Spinner {
  /**
   * Stop the animation and print a green success line in its place.
   *
   * @param text - Message after the success mark.
   */
  success(text: string): void

  /**
   * Stop the animation and print a red failure line in its place.
   *
   * @param text - Message after the failure mark.
   */
  error(text: string): void

  /**
   * Start the animation.
   *
   * @returns The same spinner, so that creating and starting it chain.
   */
  start(): Spinner
}

/**
 * Create a spinner that writes to standard error.
 *
 * In an interactive terminal the spinner redraws its row every 50 ms with the
 * cursor hidden. Elsewhere it prints its text once when it starts and the final
 * line when it stops. While it runs, SIGINT and SIGTERM erase it and show the
 * cursor before the process exits.
 *
 * @param text - Message next to the animation.
 * @returns Controls of the spinner.
 */
export function createSpinner(text: string): Spinner {
  let stream = process.stderr
  let isInteractive = isInteractiveTerminal()
  let isUnicode = isUnicodeSupported()
  let unicodeFrames = isUnicode ? UNICODE_FRAMES : ASCII_FRAMES
  let frames = isInteractive ? unicodeFrames : STATIC_FRAMES
  let frameIndex = 0
  let rows = 0
  let timer: NodeJS.Timeout | undefined
  let signalListeners: [signal: NodeJS.Signals, listener: () => void][] = []

  /**
   * Build the sequence that erases every row of the last frame, from the row of
   * the cursor up.
   *
   * @returns Escape sequence to write before the next output.
   */
  function erase(): string {
    let sequence = MOVE_TO_LINE_START
    for (let row = 0; row < rows; row++) {
      sequence += row === 0 ? ERASE_LINE : `${MOVE_UP}${ERASE_LINE}`
    }
    rows = 0
    return sequence
  }

  /**
   * Draw the current frame and plan the next one.
   */
  function render(): void {
    let frame = `${colors.yellow(frames[frameIndex])} ${text}`
    if (isInteractive) {
      timer = setTimeout(render, FRAME_INTERVAL)
      stream.write(`${HIDE_CURSOR}${erase()}${frame}`)
      rows = countTerminalRows(frame, stream.columns)
    } else {
      stream.write(`${frame}\n`)
    }
    frameIndex = (frameIndex + 1) % frames.length
  }

  /**
   * Stop the animation and replace the frame with the final output.
   *
   * @param output - Final line, or nothing to only erase the frame.
   */
  function stop(output: string): void {
    clearTimeout(timer)
    for (let [signal, listener] of signalListeners) {
      process.off(signal, listener)
    }
    signalListeners = []
    stream.write(isInteractive ? `${erase()}${output}${SHOW_CURSOR}` : output)
  }

  let spinner: Spinner = {
    start() {
      for (let [signal, code] of SIGNAL_EXIT_CODES) {
        let listener: () => void
        /**
         * The listener is written right in the call: unicorn/no-process-exit
         * allows `process.exit()` only in a handler passed to `process.on()`.
         */
        process.on(
          signal,
          (listener = () => {
            stop('')
            process.exit(code)
          }),
        )
        signalListeners.push([signal, listener])
      }
      render()
      return spinner
    },
    success(message) {
      stop(`${colors.green(isUnicode ? '✔' : '√')} ${message}\n`)
    },
    error(message) {
      stop(`${colors.red(isUnicode ? '✖' : '×')} ${message}\n`)
    },
  }

  return spinner
}
