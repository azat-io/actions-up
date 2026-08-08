/**
 * Compare two SHA hashes, accounting for short and long formats.
 *
 * @param sha1 - First SHA hash.
 * @param sha2 - Second SHA hash.
 * @returns True if the SHAs refer to the same commit.
 */
export function compareSha(sha1: string, sha2: string): boolean {
  /**
   * Normalize by removing 'v' prefix if present.
   */
  let normalized1 = sha1.replace(/^v/u, '')
  let normalized2 = sha2.replace(/^v/u, '')

  /**
   * If one SHA is shorter, compare only the common prefix.
   */
  let minLength = Math.min(normalized1.length, normalized2.length)

  /**
   * Both must be at least 7 characters (minimum SHA length).
   */
  if (minLength < 7) {
    return false
  }

  /**
   * Compare the common prefix.
   */
  return (
    normalized1.slice(0, Math.max(0, minLength)).toLowerCase() ===
    normalized2.slice(0, Math.max(0, minLength)).toLowerCase()
  )
}
