/**
 * Reference gh-actions-lock refused to pin for a workflow whose lockfile entry
 * did not track its action.
 */
export interface LockRefusal {
  /**
   * Repository of the action, `owner/repo`, in lower case.
   */
  repository: string

  /**
   * Workflow the reference was refused for, relative to the repository root.
   */
  workflow: string

  /**
   * Reference, as the workflow names it.
   */
  ref: string
}
