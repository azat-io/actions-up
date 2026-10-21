/**
 * Workflow lockfile of a repository, `.github/workflows/actions.lock`, as far
 * as the update pipeline needs it, with the actions of the repository the
 * workflows it tracks run.
 */
export interface WorkflowLockfile {
  /**
   * Absolute real paths of the workflows treated as tracked: the ones the
   * lockfile names, or every workflow of `.github/workflows` when it cannot be
   * read; null when even those cannot be listed, so that any workflow next to
   * the lockfile may be one of them.
   */
  workflows: Set<string> | null

  /**
   * Absolute real paths of the definitions (`action.yml`) of the actions of the
   * repository the tracked workflows run through local references, directly or
   * through one another; null when a workflow or a definition could not be
   * read, so that any action of the repository may be one of them.
   */
  reached: Set<string> | null

  /**
   * Schema version the file names, null when it names none.
   */
  version: string | null

  /**
   * Why the file cannot be read, absent when it can.
   */
  error?: string

  /**
   * Root of the repository the lockfile belongs to.
   */
  root: string

  /**
   * Absolute path of the lockfile.
   */
  path: string
}
