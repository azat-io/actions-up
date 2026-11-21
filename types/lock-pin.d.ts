/**
 * Commit a regenerated workflow lockfile pins for a reference.
 */
export interface LockPin {
  /**
   * Repository of the action, `owner/repo`, in lower case.
   */
  repository: string

  /**
   * Commit, in lower case.
   */
  sha: string

  /**
   * Reference, as the workflow names it.
   */
  ref: string
}
