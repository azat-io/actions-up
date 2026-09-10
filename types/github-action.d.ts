/**
 * Represents a GitHub Action used in workflows or composite actions.
 */
export interface GitHubAction {
  /**
   * Type of the GitHub Action.
   *
   * `runner` is not an action but a `runs-on` label, carried through the same
   * pipeline so that excludes, ignore comments and the interactive prompt apply
   * to it unchanged.
   */
  type:
    | 'reusable-workflow'
    | 'composite'
    | 'external'
    | 'docker'
    | 'runner'
    | 'local'

  /**
   * Version or tag of the action (e.g., 'v1', 'main', commit SHA).
   *
   * For `runner` entries this is the full `runs-on` label (e.g.
   * 'ubuntu-22.04'), because the label is what gets rewritten in the file.
   */
  version?: string | null

  /**
   * Trailing inline comment on the `uses:` line, without its leading `#`.
   */
  comment?: string

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
   *
   * For `runner` entries this is the runner family as `runner/<family>` (e.g.
   * 'runner/ubuntu'), which stays stable across image versions so that
   * `--exclude` patterns keep matching after an update.
   */
  name: string

  /**
   * Original `ref` string from workflow, if available.
   */
  ref?: string
}
