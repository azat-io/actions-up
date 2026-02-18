/**
 * Represents a step in a composite GitHub Action.
 */
export interface CompositeActionStep {
  /**
   * Environment variables for this step.
   */
  env?: Record<string, unknown>

  /**
   * Working directory for the step.
   */
  'working-directory'?: string

  /**
   * Allow additional properties.
   */
  [key: string]: unknown

  /**
   * Shell to use for the run command.
   */
  shell?: string

  /**
   * Action to use for this step.
   */
  uses?: string

  /**
   * Display name for this step.
   */
  name?: string

  /**
   * Shell command to run for this step.
   */
  run?: string
}
