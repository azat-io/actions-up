import type { ActionUpdate } from './action-update'

/**
 * Updates planned for a repository: the ones that can be written, and the ones
 * left out with the reason why. The lists are the ones `--json` reports.
 */
export interface UpdatePlan {
  /**
   * Updates held back because they would move a SHA pin to an older version
   * than its version comment names.
   */
  blockedAsDowngrade: ActionUpdate[]

  /**
   * Updates the update mode held back. Outside the major mode this includes
   * every runner update, since moving to a newer image is a major change.
   */
  blockedByMode: ActionUpdate[]

  /**
   * Updates the release age cool-down held back.
   */
  blockedByAge: ActionUpdate[]

  /**
   * Overall outcome.
   */
  status: UpdatePlanStatus

  /**
   * Entries the check skipped, each with the reason in `skipReason`.
   */
  skipped: ActionUpdate[]

  /**
   * Action updates that can be written, each with the reference to write in
   * `targetRef`.
   */
  updates: ActionUpdate[]

  /**
   * Runner label updates that can be written.
   */
  runners: ActionUpdate[]

  /**
   * Number of action references checked after the excludes, runners left out.
   */
  actionsChecked: number
}

/**
 * Overall outcome of planning the updates of a repository.
 *
 * It describes the updates that can be written only: a plan reads `up-to-date`
 * even when entries were skipped or held back.
 */
export type UpdatePlanStatus =
  'updates-available' | 'no-actions-found' | 'nothing-to-check' | 'up-to-date'
