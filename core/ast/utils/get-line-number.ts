import { hasRange } from '../guards/has-range'

/**
 * Calculates a 1-based line number for a YAML key node using its range.
 *
 * Returns 0 when the range is missing or malformed.
 *
 * @param content - Original file content used to compute line breaks.
 * @param keyNode - YAML key node that may include a `range` tuple.
 * @returns 1-based line number, or 0 when unknown.
 */
export function getLineNumberForKey(content: string, keyNode: unknown): number {
  if (hasRange(keyNode) && keyNode.range) {
    let [offset] = keyNode.range
    if (typeof offset === 'number' && Number.isFinite(offset)) {
      return content.slice(0, Math.max(0, offset)).split('\n').length
    }
  }
  return 0
}
