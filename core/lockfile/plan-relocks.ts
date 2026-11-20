import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { RelockBlocker } from '../../types/relock-blocker'
import type { RelockTarget } from '../../types/relock-target'
import type { ActionUpdate } from '../../types/action-update'
import type { LockedFile } from '../../types/locked-file'

/**
 * Plan which workflow lockfiles to regenerate once updates are written, and for
 * which workflows.
 *
 * Only an update to a locked action changes what a lockfile records: a runner
 * label or a reusable workflow called by a job is not pinned there. Each
 * written file is relocked under the workflows that record what it runs: its
 * own key when the lockfile tracks it as a workflow, and the workflows that run
 * it through `$/` when it defines an action of the repository, since a scoped
 * relock updates only the workflows it is given. A lockfile that records the
 * file under no workflow is left out, since a relock without workflows would
 * regenerate all of them; the locked entries of such a file are never written,
 * as they stay skipped.
 *
 * @param lockedFiles - Scanned files whose actions lockfiles pin, with the
 *   lockfiles that pin them.
 * @param updates - Written updates.
 * @returns A target for each lockfile to regenerate, ordered by its path, with
 *   the workflows of all its files sorted.
 */
export function planRelocks(
  lockedFiles: Map<string, LockedFile[]>,
  updates: ActionUpdate[],
): RelockTarget[] {
  let targets = new Map<WorkflowLockfile, RelockTarget>()

  for (let update of updates) {
    let { locked, file } = update.action
    let pins = locked && file !== undefined ? lockedFiles.get(file) : undefined
    if (file === undefined || !pins) {
      continue
    }
    for (let { workflows, lockfile } of pins) {
      if (workflows === null) {
        continue
      }
      let target: RelockTarget = targets.get(lockfile) ?? {
        files: new Set<string>(),
        workflows: [],
        updates: [],
        lockfile,
      }
      targets.set(lockfile, target)
      target.workflows = [...new Set([...target.workflows, ...workflows])]
      target.files.add(file)
      target.updates.push(update)
    }
  }

  return targets
    .values()
    .map(target => ({ ...target, workflows: target.workflows.toSorted() }))
    .toArray()
    .toSorted((first, second) =>
      first.lockfile.path.localeCompare(second.lockfile.path),
    )
}

/**
 * Find why the lockfiles that pin a scanned file cannot all be regenerated for
 * it, for each file where they cannot.
 *
 * A lockfile this release cannot read does not say which workflows it tracks,
 * and one whose workflows or actions cannot all be read does not say which of
 * them run an action of the repository. One that does not record what the file
 * runs under every workflow that runs it, as for an action a workflow runs only
 * through `./`, would stay stale for that workflow after a relock, and a relock
 * of a workflow that runs remote actions through `./` alone may drop the pins
 * those actions run. And a file that the lockfiles of more than one repository
 * root pin, as an action of a nested repository may be, could only be put back
 * for one of them by leaving the other stale. The locked entries of such a file
 * stay skipped; the others can be updated once gh-actions-lock is there to
 * regenerate their lockfiles.
 *
 * @param lockedFiles - Scanned files whose actions lockfiles pin, with the
 *   lockfiles that pin them.
 * @returns The files that cannot be relocked, as the scan names them, each with
 *   the reason.
 */
export function findRelockBlockers(
  lockedFiles: Map<string, LockedFile[]>,
): Map<string, RelockBlocker> {
  let blockers = new Map<string, RelockBlocker>()
  for (let [file, pins] of lockedFiles) {
    let unrecorded = pins.filter(({ workflows }) => workflows === null)
    if (
      unrecorded.some(
        ({ lockfile }) => lockfile.keys === null || lockfile.reached === null,
      )
    ) {
      blockers.set(file, 'unreadable')
    } else if (unrecorded.length > 0) {
      blockers.set(file, 'unrecorded')
    } else if (pins.length > 1) {
      blockers.set(file, 'shared')
    }
  }
  return blockers
}
