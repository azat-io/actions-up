import type { ActionUpdate } from '../../types/action-update'
import type { PinMismatch } from '../../types/pin-mismatch'
import type { LockRefusal } from '../../types/lock-refusal'
import type { LockPin } from '../../types/lock-pin'

/**
 * Find the written references that a regenerated workflow lockfile does not pin
 * the way Actions Up checked them.
 *
 * The relock can exit with success in cases that still leave a written
 * reference unchecked. An action the entry of a workflow did not track is not
 * added to it, and that is reported for the workflow alone, while the pins are
 * reported merged across workflows, so a pin of the same reference for another
 * workflow does not count. So each written reference must be refused for no
 * workflow, pinned, and to the commit the plan checked when that commit is
 * known; a SHA names its own commit. A repository that was renamed or
 * transferred is pinned under its new name, with the same reference and commit,
 * so a pin of the reference at the checked commit counts under any name. A
 * reference the lockfile already pinned, as for another workflow, keeps the
 * commit pinned there, which may be older than the checked one; the lockfile
 * then matches the files, but runs another commit than the checked one, so that
 * is told apart. Any other commit means the reference moved after the check.
 * The lockfile names the repository of a pin in lower case.
 *
 * @param updates - Written updates of the actions the lockfile pins.
 * @param relocked - What the regenerated lockfile pins, merged across
 *   workflows, and the references the relock refused to pin for a workflow.
 * @param relocked.pins - What the lockfile pins.
 * @param relocked.refusals - What the relock refused to pin.
 * @param recorded - Commit the lockfile pinned each reference to before the
 *   relock, in lower case, by `owner/repo@ref` with the repository in lower
 *   case.
 * @returns What is not pinned as checked, once for each reference and workflow,
 *   in the order of the updates.
 */
export function findPinMismatches(
  updates: ActionUpdate[],
  relocked: { refusals: LockRefusal[]; pins: LockPin[] },
  recorded: Map<string, string>,
): PinMismatch[] {
  let pinned = new Map(
    relocked.pins.map(pin => [`${pin.repository}@${pin.ref}`, pin.sha]),
  )
  let refused = Map.groupBy(
    relocked.refusals,
    refusal => `${refusal.repository}@${refusal.ref}`,
  )
  let checkedKeys = new Set<string>()
  let mismatches: PinMismatch[] = []

  for (let update of updates) {
    let reference = update.targetRef ?? update.latestSha
    let [owner, repository] = update.action.name.split('/', 2)
    let key = `${`${owner}/${repository}`.toLowerCase()}@${reference}`
    if (!reference || !owner || !repository || checkedKeys.has(key)) {
      continue
    }
    checkedKeys.add(key)

    let name = `${owner}/${repository}@${reference}`
    let workflows = new Set(refused.get(key)?.map(({ workflow }) => workflow))
    let checked = update.latestSha?.toLowerCase()
    let sha =
      pinned.get(key) ??
      relocked.pins.find(pin => pin.ref === reference && pin.sha === checked)
        ?.sha

    for (let workflow of workflows) {
      mismatches.push({ kind: 'refused', reference: name, workflow })
    }
    if (sha === undefined && workflows.size === 0) {
      mismatches.push({ kind: 'missing', reference: name })
    } else if (sha && checked && sha !== checked) {
      mismatches.push({
        kind: recorded.get(key) === sha ? 'kept-commit' : 'other-commit',
        reference: name,
        pinned: sha,
        checked,
      })
    }
  }

  return mismatches
}
