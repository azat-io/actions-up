import type { GitHubAction } from './github-action'

/** Update information for a GitHub Action. */
export interface ActionUpdate {
  /** Reason for skipping the update check. */
  skipReason?: 'unknown' | 'branch'

  /** Current version string. */
  currentVersion: string | null

  /** Latest available version. */
  latestVersion: string | null

  /** Status of the check for this action. */
  status?: 'skipped' | 'ok'

  /** SHA hash of the latest version. */
  latestSha: string | null

  /** Publication date of the latest version (null if unknown). */
  publishedAt: Date | null

  /** The original action from scanning. */
  action: GitHubAction

  /** Whether this is a major version change. */
  isBreaking: boolean

  /** Whether an update is available. */
  hasUpdate: boolean
}
