import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { ActionUpdate } from '../../types/action-update'

import { isSha } from '../versions/is-sha'

/**
 * Tell whether writing a locked update and regenerating its lockfile would move
 * the workflow back to an older commit.
 *
 * A relock without `--relock` keeps the commit the lockfile already pins for a
 * reference, as for another workflow, so the reference an update writes then
 * runs that commit rather than the checked one. An update that moves the
 * workflow forward, such as one to the next major version, still does, and the
 * regeneration names the kept commit. One that writes the commit the workflow
 * runs already, only in another form, as a tag of the latest version written as
 * its floating tag, would leave the workflow on the older commit instead. The
 * commit the workflow runs is the one its SHA names, or the one the lockfile
 * pins for the reference as written; while it is unknown, the update is not
 * taken for one that moves the workflow back. References are matched the way
 * the lockfile keys them: by the repository in lower case, without the path of
 * an action in a subdirectory, and the reference as written.
 *
 * @param update - Locked update, with the reference it writes resolved.
 * @param lockfile - Lockfile that pins what the file of the update runs.
 * @returns True when the lockfile pins the reference the update writes at
 *   another commit than the checked one, while the workflow runs the checked
 *   commit already.
 */
export function movesWorkflowBack(
  update: Pick<ActionUpdate, 'targetRef' | 'latestSha' | 'action'>,
  lockfile: Pick<WorkflowLockfile, 'commits'>,
): boolean {
  let { latestSha, targetRef, action } = update
  let { commits } = lockfile
  let [owner, repository] = action.name.split('/', 2)
  let current = action.version

  if (
    !commits ||
    !owner ||
    !repository ||
    !targetRef ||
    !current ||
    !latestSha
  ) {
    return false
  }

  let name = `${owner}/${repository}`.toLowerCase()
  let checked = latestSha.toLowerCase()
  let kept = commits.get(`${name}@${targetRef}`)
  let running =
    isSha(current) ? current.toLowerCase() : commits.get(`${name}@${current}`)

  return kept !== undefined && kept !== checked && running === checked
}
