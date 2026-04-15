import type { GitHubAction } from './github-action'

/**
 * Update information for a GitHub Action.
 */
export interface ActionUpdate {
  /**
   * Reason for skipping the update check.
   */
  skipReason?: 'unsupported-style' | 'unknown' | 'branch'

  /**
   * Detected style of the current reference in the source file.
   */
  currentRefType?: 'unknown' | 'branch' | 'sha' | 'tag'

  /**
   * Style of the final reference that should be written back to the file.
   */
  targetRefStyle?: 'sha' | 'tag' | null

  /**
   * Current version string.
   */
  currentVersion: string | null

  /**
   * Latest available version.
   */
  latestVersion: string | null

  /**
   * Status of the check for this action.
   */
  status?: 'skipped' | 'ok'

  /**
   * Final reference that should be written back to the file.
   */
  targetRef?: string | null

  /**
   * SHA hash of the latest version.
   */
  latestSha: string | null

  /**
   * Publication date of the latest version (null if unknown).
   */
  publishedAt: Date | null

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
