import type { AgeSource } from './age-source'

/**
 * Verdict on a candidate tag, with what was learned about it on the way.
 */
export interface CandidateAssessment {
  /**
   * Why the candidate cannot be written, null when it can.
   */
  reason: CandidateHoldReason | null

  /**
   * Whether the release of the tag is immutable, so its tag cannot move; null
   * when the release was not looked up.
   */
  immutableRelease: boolean | null

  /**
   * Where `effectiveDate` came from.
   */
  ageSource: AgeSource | null

  /**
   * Moment from which GitHub's records show the commit public, which the
   * cool-down measured; null when the cool-down did not apply or no such moment
   * was established.
   */
  effectiveDate: Date | null

  /**
   * Publication date of the release of the tag, null when it has none or the
   * release was not looked up.
   */
  publishedAt: Date | null

  /**
   * Commit the tag points at, null when it could not be resolved.
   */
  sha: string | null
}

/**
 * Why a candidate tag cannot be written.
 *
 * - `no-commit`: GitHub answered that the tag points at no commit, such as a tag
 *   deleted since it was listed or one that points at a tree.
 * - `sha-unresolved`: the lookup of the commit the tag points at failed.
 * - `cool-down`: the release of the tag, or the arrival of its commit on the
 *   branch that holds it, is inside the cool-down.
 * - `age-unknown`: the cool-down applies but nothing GitHub records shows the
 *   commit public for long enough.
 * - `tag-moved`: a workflow pins another commit under the version comment of this
 *   very tag, so the tag was moved after the pin was written.
 * - `unreachable-commit`: neither the default branch nor a protected branch of
 *   the repository holds the commit.
 * - `reachability-unknown`: the history of the repository could not be checked.
 */
export type CandidateHoldReason =
  | 'reachability-unknown'
  | 'unreachable-commit'
  | 'sha-unresolved'
  | 'age-unknown'
  | 'no-commit'
  | 'tag-moved'
  | 'cool-down'
