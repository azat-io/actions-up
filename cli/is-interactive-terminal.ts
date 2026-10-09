import { isatty } from 'node:tty'

/**
 * Check whether the spinner may animate its row in place.
 *
 * Standard output has to be a terminal that understands cursor movement, and
 * the process must not run in CI. The spinner writes to standard error, yet
 * standard output decides, and a `CI` variable counts even when it is empty.
 *
 * @returns True when the spinner may redraw its row.
 */
export function isInteractiveTerminal(): boolean {
  return isatty(1) && process.env['TERM'] !== 'dumb' && !('CI' in process.env)
}
