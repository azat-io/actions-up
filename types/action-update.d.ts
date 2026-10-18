import type { GitHubAction } from './github-action'
import type { HoldReason } from './hold-reason'
import type { AgeSource } from './age-source'
import type { TrustHold } from './trust-hold'

/**
 * Update information for a GitHub Action.
 */
export interface ActionUpdate {
  /**
   * Reason for skipping the update check. `sha-unresolved` means the commit the
   * tag of the latest version points at could not be read,
   * `reachability-unknown` that the history of its repository could not be
   * checked, and `release-unresolved` that the release which tells a moved tag
   * from a pin written by hand could not be read; none falls back to another
   * commit.
   */
  skipReason?:
    | 'reachability-unknown'
    | 'ref-type-unavailable'
    | 'release-unresolved'
    | 'unsupported-style'
    | 'not-comparable'
    | 'sha-unresolved'
    | 'check-failed'
    | 'tag-family'
    | 'not-found'
    | 'unknown'
    | 'branch'

  /**
   * Detected style of the current reference in the source file.
   */
  currentRefType?: 'unknown' | 'branch' | 'sha' | 'tag'

  /**
   * Style of the final reference that should be written back to the file.
   */
  targetRefStyle?: 'sha' | 'tag' | null

  /**
   * True when rate limiting prevented validating floating tag candidates and
   * the exact latest version was used as a fallback.
   */
  targetRefRateLimited?: boolean

  /**
   * Current version string.
   */
  currentVersion: string | null

  /**
   * Where `effectiveDate` came from: `release` for the publication of the
   * release of the latest version, `branch` for the recorded history of the
   * branch that holds its commit.
   */
  ageSource?: AgeSource | null

  /**
   * Latest available version.
   */
  latestVersion: string | null

  /**
   * Moment from which GitHub's own records show the commit of the latest
   * version public: the publication of its immutable release, or the update of
   * the branch that holds the commit which left a tip containing it. For an
   * update held back by a recent release, its publication date. Null when the
   * cool-down did not apply or no such moment was established. The dates
   * written into commits and tags are never used.
   */
  effectiveDate?: Date | null

  /**
   * Whether the latest version has an immutable release, whose tag cannot have
   * been moved since it was published; absent when the release was not read.
   */
  immutableRelease?: boolean

  /**
   * Status of the check for this action.
   */
  status?: 'skipped' | 'ok'

  /**
   * Final reference that should be written back to the file.
   */
  targetRef?: string | null

  /**
   * Tags held back because their commit failed a trust check, newest first: on
   * an update held back for that reason, and on an update that stepped down
   * past them to an older version.
   */
  trustHolds?: TrustHold[]

  /**
   * Commit the tag of the latest version points at, read from the tag
   * reference.
   */
  latestSha: string | null

  /**
   * Publication date of the release of the latest version, null when it has
   * none or it was not looked up.
   */
  publishedAt: Date | null

  /**
   * Why the update was held back, on the updates a plan holds back.
   */
  holdReason?: HoldReason

  /**
   * The original action from scanning.
   */
  action: GitHubAction

  /**
   * Whether this is a major version change.
   */
  isBreaking: boolean

  /**
   * Whether an update is available.
   */
  hasUpdate: boolean
}
