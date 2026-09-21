/**
 * Check if a value is a commit SHA exactly as Git writes it.
 *
 * Unlike `isSha`, a leading `v` is not stripped: a commit SHA is plain hex, so
 * a value such as `v20240101` names a branch rather than a commit.
 *
 * @param value - Value to check.
 * @returns True if the value consists of 7 to 40 hex characters.
 */
export function isCommitSha(value: undefined | string | null): boolean {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/iu.test(value)
}
