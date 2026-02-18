import type { GitHubAction } from './github-action'

/**
 * Result of scanning a repository for GitHub Actions usage.
 */
export interface ScanResult {
  /**
   * Map of workflow files to their used GitHub Actions.
   */
  workflows: Map<string, GitHubAction[]>

  /**
   * Map of composite action names to their file paths.
   */
  compositeActions: Map<string, string>

  /**
   * List of all unique GitHub Actions found in the repository.
   */
  actions: GitHubAction[]
}
