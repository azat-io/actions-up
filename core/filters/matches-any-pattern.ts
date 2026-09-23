/**
 * Checks whether a name matches at least one of the given patterns.
 *
 * @param name - Action or runner name to test.
 * @param patterns - Compiled patterns, as returned by `parseExcludePatterns`.
 * @returns True when any pattern matches the name.
 */
export function matchesAnyPattern(name: string, patterns: RegExp[]): boolean {
  for (let pattern of patterns) {
    /**
     * A user-supplied `/pattern/g` keeps its `lastIndex` between calls, so a
     * repeated name would match only every other time. The same patterns are
     * reused for every entry of a run, which makes the carry-over span all
     * calls.
     */
    pattern.lastIndex = 0
    if (pattern.test(name)) {
      return true
    }
  }
  return false
}
