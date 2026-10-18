/**
 * Branch together with the commit at its tip.
 */
export interface BranchHead {
  /**
   * Branch name, such as `releases/v4`.
   */
  name: string

  /**
   * Commit at the tip of the branch.
   */
  sha: string
}
