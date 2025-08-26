import type { WorkflowJob } from '../../../types/workflow-job'

/**
 * Type guard to check if a value conforms to the WorkflowJob interface.
 *
 * @param value - The value to check.
 * @returns True if the value is a valid workflow job.
 */
export function isWorkflowJob(value: unknown): value is WorkflowJob {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  /**
   * A job must have either 'runs-on' for regular jobs or 'uses' for reusable
   * workflows, or 'container' for container jobs.
   */
  let object = value as Record<string, unknown>
  return (
    'runs-on' in object ||
    'uses' in object ||
    'container' in object ||
    'steps' in object
  )
}
