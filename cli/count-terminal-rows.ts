import { stripAnsi } from '../core/interactive/strip-ansi'

/**
 * Width assumed when the terminal does not report a usable one.
 */
const DEFAULT_COLUMNS = 80

/**
 * Count the terminal rows a printed text takes, wrapping every line at the
 * width of the terminal.
 *
 * A terminal that never had its size set reports zero columns, which counts as
 * the default width rather than as an endless number of rows.
 *
 * @param text - Printed text, possibly with colors and line breaks.
 * @param columns - Width of the terminal, when known.
 * @returns Number of rows the text takes.
 */
export function countTerminalRows(text: string, columns?: number): number {
  let width = columns === undefined || columns === 0 ? DEFAULT_COLUMNS : columns
  let rows = 0
  for (let line of stripAnsi(text).split('\n')) {
    rows += Math.max(1, Math.ceil(line.length / width))
  }
  return rows
}
