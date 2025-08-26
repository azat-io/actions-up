import type { WorkflowStructure } from '../../../types/workflow-structure'

/**
 * Type guard to check if a value conforms to the WorkflowStructure interface.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid workflow structure.
 */
export function isWorkflowStructure(
  value: unknown,
): value is WorkflowStructure {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  /**
   * A workflow must have at least 'on' field to define triggers or 'name' field
   * is common but not strictly required.
   */
  let object = value as Record<string, unknown>
  return 'on' in object || 'name' in object || 'jobs' in object
}
