import type { WorkflowJob } from './workflow-job'

/**
 * Represents the root structure of a GitHub Actions workflow file.
 */
export interface WorkflowStructure {
  /**
   * Map of job IDs to job configurations.
   */
  jobs?: Record<string, WorkflowJob>

  /**
   * Allow additional properties for workflow configuration.
   */
  [key: string]: unknown

  /**
   * Display name for the workflow.
   */
  name?: string

  /**
   * Events that trigger the workflow (push, pull_request, etc.).
   */
  on?: unknown
}
