/**
 * Check if a string is a Git SHA hash.
 *
 * @param value - String to check.
 * @returns True if the string is a SHA hash.
 */
export function isSha(value: undefined | string | null): boolean {
  if (!value) {
    return false
  }

  /**
   * Remove 'v' prefix if present.
   */
  let normalized = value.replace(/^v/u, '')

  /**
   * Check if it matches SHA pattern (7-40 hex characters).
   */
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}
