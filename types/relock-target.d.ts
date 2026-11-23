import type { WorkflowLockfile } from './workflow-lockfile'
import type { ActionUpdate } from './action-update'

/**
 * Workflow lockfile to regenerate once entries are written, and what for.
 */
export interface RelockTarget {
  /**
   * Written files whose entries the lockfile pins, as the scan names them, each
   * with the tracked workflows the lockfile records it under, as it names
   * them.
   */
  files: Map<string, string[]>

  /**
   * Lockfile to regenerate.
   */
  lockfile: WorkflowLockfile

  /**
   * Written updates of the actions the lockfile pins, in the order given, to
   * check the regenerated lockfile against.
   */
  updates: ActionUpdate[]

  /**
   * Tracked workflows to relock, as the lockfile names them: those under which
   * it records what the written files run, sorted.
   */
  workflows: string[]
}
