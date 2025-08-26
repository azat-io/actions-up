import type { CompositeActionStep } from '../../../types/composite-action-step'

/**
 * Type guard to check if a value conforms to the CompositeActionStep interface.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid composite action step.
 */
export function isCompositeActionStep(
  value: unknown,
): value is CompositeActionStep {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  /**
   * A composite action step must have either 'run' for shell commands or 'uses'
   * for actions.
   */
  let object = value as Record<string, unknown>
  return 'run' in object || 'uses' in object
}
