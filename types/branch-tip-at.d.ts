/**
 * Tip of a branch at a past moment, as the recorded history of the branch tells
 * it, kept by the branch ever since.
 */
export interface BranchTipAt {
  /**
   * Commit at the tip then, null when the branch as it is now did not exist
   * then.
   */
  sha: string | null

  /**
   * Moment of the update that left that commit at the tip, null when it
   * predates the recorded history or there was no tip.
   */
  since: Date | null
}
