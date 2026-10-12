import { stripAnsi } from '../strip-ansi'

/**
 * Count the rows of the screen a line of text takes in a terminal that wraps it
 * at its width.
 *
 * Like the prompt library the list replaced, it counts the code points of the
 * text without colors, so a wide character counts as one column.
 *
 * @param line - Line of text, possibly colored.
 * @param columns - Width of the terminal.
 * @returns Number of rows, at least one.
 */
export function countScreenRows(line: string, columns: number): number {
  let width = [...stripAnsi(line)].length
  return 1 + Math.floor(Math.max(width - 1, 0) / columns)
}
