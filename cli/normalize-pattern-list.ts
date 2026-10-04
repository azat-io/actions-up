/**
 * Normalizes a repeatable pattern option that also accepts comma-separated
 * values.
 *
 * Only the commas between patterns separate them: a comma inside `()`, `[]` or
 * `{}` belongs to the regular expression (`v{1,3}`, `[a,b]`), and an escaped
 * `\,` never separates.
 *
 * @param patterns - Raw option values as collected by the argument parser.
 * @returns Individual trimmed patterns, without empty entries.
 */
export function normalizePatternList(patterns: undefined | string[]): string[] {
  return (patterns ?? [])
    .flatMap(item => splitPatterns(item))
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * Splits one option value on the commas outside regular expression groups,
 * character classes, quantifier ranges and escapes.
 *
 * @param value - Raw option value.
 * @returns Patterns in their original order, untrimmed.
 */
function splitPatterns(value: string): string[] {
  let patterns: string[] = []
  let current = ''
  let depth = 0
  let isEscaped = false
  let isInClass = false

  for (let character of value) {
    if (isEscaped) {
      isEscaped = false
    } else if (character === '\\') {
      isEscaped = true
    } else if (isInClass) {
      isInClass = character !== ']'
    } else if (character === '[') {
      isInClass = true
    } else if (character === '(' || character === '{') {
      depth += 1
    } else if ((character === ')' || character === '}') && depth > 0) {
      depth -= 1
    } else if (character === ',' && depth === 0) {
      patterns.push(current)
      current = ''
      continue
    }

    current += character
  }

  patterns.push(current)

  return patterns
}
