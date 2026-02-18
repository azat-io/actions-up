/**
 * Represents a GitHub Action used in workflows or composite actions.
 */
export interface GitHubAction {
  /**
   * Type of the GitHub Action.
   */
  type: 'reusable-workflow' | 'composite' | 'external' | 'docker' | 'local'

  /**
   * Version or tag of the action (e.g., 'v1', 'main', commit SHA).
   */
  version?: string | null

  /**
   * Line number where the action is used in the file.
   */
  line?: number

  /**
   * Path to the file where this action is used.
   */
  file?: string

  /**
   * Original `uses` string from workflow, if available.
   */
  uses?: string

  /**
   * Name of the job where this action is used (for workflows).
   */
  job?: string

  /**
   * Full name of the action (e.g., 'actions/checkout').
   */
  name: string

  /**
   * Original `ref` string from workflow, if available.
   */
  ref?: string
}
