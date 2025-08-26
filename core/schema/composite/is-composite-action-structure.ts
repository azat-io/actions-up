import type { CompositeActionStructure } from '../../../types/composite-action-structure'

/**
 * Type guard to check if a value conforms to the CompositeActionStructure
 * interface.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid composite action structure.
 */
export function isCompositeActionStructure(
  value: unknown,
): value is CompositeActionStructure {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  /** A composite action should have at least 'name', 'description', or 'runs'. */
  let object = value as Record<string, unknown>
  return 'name' in object || 'description' in object || 'runs' in object
}
