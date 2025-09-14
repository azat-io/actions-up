/**
 * Parse CLI --exclude patterns into regular expressions.
 *
 * Supports two forms:
 *
 * - Raw regex literal with optional flags: `/pattern/i`
 * - Plain pattern string compiled as case-insensitive regex: `pattern`.
 *
 * Commas should be split at the CLI level; this function assumes patterns are
 * already individual entries.
 *
 * Invalid patterns are skipped with a console warning.
 *
 * @param patterns - List of pattern strings provided via CLI.
 * @returns Array of RegExp objects.
 */
export function parseExcludePatterns(patterns: string[]): RegExp[] {
  let result: RegExp[] = []

  for (let original of patterns) {
    let input = original.trim()
    if (!input) {
      continue
    }

    let regex: RegExp | null

    if (input.startsWith('/') && input.lastIndexOf('/') > 0) {
      let lastSlash = input.lastIndexOf('/')
      let body = input.slice(1, lastSlash)
      let flags = input.slice(lastSlash + 1)
      try {
        regex = new RegExp(body, flags || 'i')
      } catch (error) {
        console.warn(`Invalid regex exclude: ${original}`, error)
        regex = null
      }
    } else {
      try {
        regex = new RegExp(input, 'i')
      } catch (error) {
        console.warn(`Invalid regex exclude: ${original}`, error)
        regex = null
      }
    }

    if (regex) {
      result.push(regex)
    }
  }

  return result
}
