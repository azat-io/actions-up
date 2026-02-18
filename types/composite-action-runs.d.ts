import type { CompositeActionStep } from './composite-action-step'

/**
 * Represents the runs configuration for a composite action.
 */
export interface CompositeActionRuns {
  /**
   * Array of steps to execute.
   */
  steps?: CompositeActionStep[]

  /**
   * Allow additional properties.
   */
  [key: string]: unknown

  /**
   * Must be 'composite' for composite actions.
   */
  using?: string
}
