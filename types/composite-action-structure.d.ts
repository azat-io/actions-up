import type { CompositeActionRuns } from './composite-action-runs'

/** Represents the structure of a composite GitHub Action file. */
export interface CompositeActionStructure {
  /** Output values from the action. */
  outputs?: Record<string, unknown>

  /** Input parameters for the action. */
  inputs?: Record<string, unknown>

  /** Runs configuration for composite actions. */
  runs?: CompositeActionRuns

  /** Allow additional properties. */
  [key: string]: unknown

  /** Description of what the action does. */
  description?: string

  /** Display name of the action. */
  name?: string
}
