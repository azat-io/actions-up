/**
 * Where a commit sits in the history of its repository.
 */
export interface CommitTrace {
  /**
   * With a moment to look back to, whether the default branch or a protected
   * branch already held the commit then and has kept it since: `no` only once
   * every one of them that holds it now is known to have got it later; null
   * without a moment.
   */
  heldAtCutoff: Verdict | null

  /**
   * Moment of the branch update that left a tip holding the commit, when
   * `heldAtCutoff` is `yes` and that update is recorded.
   */
  heldSince: Date | null

  /**
   * Whether the default branch or a protected branch holds the commit now.
   */
  inHistory: Verdict
}

/**
 * Answer GitHub can give about a commit, or leave open.
 */
export type Verdict = 'unknown' | 'yes' | 'no'
