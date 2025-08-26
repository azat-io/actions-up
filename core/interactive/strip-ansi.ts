/**
 * Remove ANSI escape codes from a string.
 *
 * @param string - String with potential ANSI codes.
 * @returns String without ANSI codes.
 */
export function stripAnsi(string: string): string {
  let result = ''
  let i = 0

  while (i < string.length) {
    if (
      string.charCodeAt(i) === 0x1b &&
      i + 1 < string.length &&
      string[i + 1] === '['
    ) {
      i += 2
      while (i < string.length) {
        let char = string[i]!
        i++
        if (char === 'm') {
          break
        }
        if (!/[\d;]/u.test(char)) {
          result += `${String.fromCharCode(0x1b)}[${string.slice(i - 1, i)}`
          break
        }
      }
    } else {
      result += string[i]
      i++
    }
  }

  return result
}
