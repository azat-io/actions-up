import type { WorkflowStep } from '../../../types/workflow-step'

/**
 * Type guard to check if a value conforms to the WorkflowStep interface.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid workflow step.
 */
export function isWorkflowStep(value: unknown): value is WorkflowStep {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  /** A step must have either 'run' for shell commands or 'uses' for actions. */
  let object = value as Record<string, unknown>
  return 'run' in object || 'uses' in object
}
