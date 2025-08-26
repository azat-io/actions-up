import type { CompositeActionRuns } from '../../../types/composite-action-runs'

/**
 * Type guard to check if a value conforms to the CompositeActionRuns interface.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid runs configuration.
 */
export function isCompositeActionRuns(
  value: unknown,
): value is CompositeActionRuns {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  /**
   * A composite action runs configuration must have 'using' field. For
   * composite actions, 'using' should be 'composite'.
   */
  let object = value as Record<string, unknown>
  return 'using' in object
}
