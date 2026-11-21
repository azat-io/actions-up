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
   * Reference as the workflow writes it, `owner/repo@ref` with the path of an
   * action in a subdirectory after the repository.
   */
  dependency: string

  /**
   * Workflow the reference was refused for, relative to the repository root.
   */
  workflow: string

  /**
   * Reference, as the workflow names it.
   */
  ref: string
}
