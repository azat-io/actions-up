/**
 * Problem gh-actions-lock reported that blocks regenerating the lockfile.
 */
export interface LockFinding {
  /**
   * Section of the gh-actions-lock troubleshooting guide about the finding,
   * null when none is given.
   */
  docUrl: string | null

  /**
   * Workflow the finding is about, relative to the repository root.
   */
  workflow: string

  /**
   * Kind of the finding, such as `ref-missing` or `tag-commit-mismatch`.
   */
  category: string

  /**
   * What was found.
   */
  detail: string
}
