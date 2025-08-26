import type { GitHubAction } from './github-action'

/** Update information for a GitHub Action. */
export interface ActionUpdate {
  /** Current version string. */
  currentVersion: string | null

  /** Latest available version. */
  latestVersion: string | null

  /** SHA hash of the latest version. */
  latestSha: string | null

  /** The original action from scanning. */
  action: GitHubAction

  /** Whether this is a major version change. */
  isBreaking: boolean

  /** Whether an update is available. */
  hasUpdate: boolean
}
