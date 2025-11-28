import type { WorkflowStep } from './workflow-step'

/** Represents a job in a GitHub Actions workflow. */
export interface WorkflowJob {
  /** Secrets passed to the reusable workflow ('inherit' or specific secrets). */
  secrets?: Record<string, unknown> | 'inherit'

  /** Input parameters passed to the reusable workflow. */
  with?: Record<string, unknown>

  /** Runner environment(s) to execute this job on (e.g., 'ubuntu-latest'). */
  'runs-on'?: string[] | string

  /** Job IDs that must complete successfully before this job runs. */
  needs?: string[] | string

  /** Array of steps to execute in this job. */
  steps?: WorkflowStep[]

  /** Allow additional properties for job configuration. */
  [key: string]: unknown

  /** Reusable workflow reference (mutually exclusive with 'steps'). */
  uses?: string

  /** Conditional expression to determine if the job should run. */
  if?: string
}
