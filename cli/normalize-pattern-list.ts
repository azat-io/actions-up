/**
 * Normalizes a repeatable pattern option that also accepts comma-separated
 * values.
 *
 * @param patterns - Raw option values as collected by the argument parser.
 * @returns Individual trimmed patterns, without empty entries.
 */
export function normalizePatternList(patterns: undefined | string[]): string[] {
  return (patterns ?? [])
    .flatMap(item => item.split(','))
    .map(item => item.trim())
    .filter(Boolean)
}
