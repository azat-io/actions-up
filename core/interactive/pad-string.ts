import { stripAnsi } from './strip-ansi'

/**
 * Pad a string to a specific length.
 *
 * @param string - String to pad.
 * @param length - Target length.
 * @returns Padded string.
 */
export function padString(string: string, length: number): string {
  let stripped = stripAnsi(string)
  let diff = length - stripped.length

  if (diff <= 0) {
    return string
  }

  let padding = ' '.repeat(diff)
  return string + padding
}
