/** Represents a single step in a GitHub Actions workflow job. */
export interface WorkflowStep {
  /** Input parameters to pass to the action. */
  with?: Record<string, unknown>

  /** Environment variables to set for this step. */
  env?: Record<string, unknown>

  /** Allow additional properties for step configuration. */
  [key: string]: unknown

  /** Action to use for this step (e.g., 'actions/checkout@v4'). */
  uses?: string

  /** Display name for this step. */
  name?: string

  /** Shell command to run for this step. */
  run?: string
}
