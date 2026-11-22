import type { RelockTarget } from '../../types/relock-target'
import type { PinMismatch } from '../../types/pin-mismatch'
import type { LockRefusal } from '../../types/lock-refusal'
import type { LockPin } from '../../types/lock-pin'

/**
 * Reference the updates wrote, and where.
 */
interface WrittenReference {
  /**
   * Commit the plan checked for it, in lower case, when it is known.
   */
  checked: undefined | string

  /**
   * Workflows the lockfile records the files it was written to under, as it
   * names them.
   */
  workflows: Set<string>

  /**
   * Reference, as written after `@`.
   */
  reference: string

  /**
   * Repository and reference, as written.
   */
  name: string

  /**
   * Key the lockfile pins it under, with the repository in lower case.
   */
  key: string
}

/**
 * What a workflow lockfile records once regenerated, as read from the disk.
 */
interface WrittenLockfile {
  /**
   * Commit each pin resolves to, in lower case, by its key, `owner/repo@ref`
   * with the repository in lower case.
   */
  commits: Map<string, string>

  /**
   * Keys of the pins of each tracked workflow, by the path of the workflow.
   */
  pins: Map<string, string[]>
}

/**
 * Find the written references that a regenerated workflow lockfile does not pin
 * the way Actions Up checked them.
 *
 * The relock can exit with success in cases that still leave a written
 * reference unchecked. An action the entry of a workflow did not track is not
 * added to it, and that is reported for the workflow alone, while the pins are
 * reported merged across workflows, so a pin of the same reference for another
 * workflow does not count. A refusal counts only for a workflow that the
 * lockfile records a file the reference was written to under: another workflow
 * runs the reference where the run did not write it, so its entry was stale
 * before. So each written reference must be refused for none of its workflows,
 * pinned, and to the commit the plan checked when that commit is known; a SHA
 * names its own commit. A repository that was renamed or transferred is pinned
 * under its new name, with the same reference and commit, so a pin of the
 * reference at the checked commit counts under any name. A reference the
 * lockfile already pinned, as for another workflow, keeps the commit pinned
 * there, which may be older than the checked one; the lockfile then matches the
 * files, but runs another commit than the checked one, so that is told apart.
 * Any other commit means the reference moved after the check. The lockfile
 * names the repository of a pin in lower case.
 *
 * What gh-actions-lock reports is checked against the lockfile it wrote, too:
 * for each workflow it was not refused for, a reference it reports as pinned
 * has to be among the pins of the workflow on disk, or under the new name of
 * its repository with the same reference at the checked commit, and at the
 * commit it reports. So a release that reports pins it did not write fails as
 * well.
 *
 * @param target - What the lockfile was regenerated for.
 * @param target.updates - Written updates of the actions the lockfile pins.
 * @param target.files - Written files, each with the workflows the lockfile
 *   records it under.
 * @param relocked - What the regenerated lockfile pins, merged across
 *   workflows, and the references the relock refused to pin for a workflow.
 * @param relocked.pins - What the lockfile pins.
 * @param relocked.refusals - What the relock refused to pin.
 * @param lockfile - What the lockfile records before and after the relock.
 * @param lockfile.recorded - Commit the lockfile pinned each reference to
 *   before the relock, in lower case, by `owner/repo@ref` with the repository
 *   in lower case.
 * @param lockfile.written - What the lockfile on disk records once regenerated.
 * @returns What is not pinned as checked, once for each reference and workflow,
 *   in the order of the updates.
 */
export function findPinMismatches(
  target: Pick<RelockTarget, 'updates' | 'files'>,
  relocked: { refusals: LockRefusal[]; pins: LockPin[] },
  lockfile: { recorded: Map<string, string>; written: WrittenLockfile },
): PinMismatch[] {
  let { recorded, written } = lockfile
  let pinned = new Map(
    relocked.pins.map(pin => [`${pin.repository}@${pin.ref}`, pin.sha]),
  )
  let refused = Map.groupBy(
    relocked.refusals,
    refusal => `${refusal.repository}@${refusal.ref}`,
  )

  return groupWritten(target)
    .values()
    .flatMap(({ reference, workflows, checked, name, key }) => {
      let mismatches: PinMismatch[] = []
      let refusedFor = new Set(
        refused
          .get(key)
          ?.map(({ workflow }) => workflow)
          .filter(workflow => workflows.has(workflow)),
      )
      let sha =
        pinned.get(key) ??
        relocked.pins.find(pin => pin.ref === reference && pin.sha === checked)
          ?.sha

      for (let workflow of refusedFor) {
        mismatches.push({ kind: 'refused', reference: name, workflow })
      }
      if (sha === undefined && refusedFor.size === 0) {
        mismatches.push({ kind: 'missing', reference: name })
      } else if (sha && checked && sha !== checked) {
        mismatches.push({
          kind: recorded.get(key) === sha ? 'kept-commit' : 'other-commit',
          workflows: [...workflows].toSorted(),
          reference: name,
          pinned: sha,
          checked,
        })
      }
      if (sha !== undefined) {
        for (let workflow of workflows) {
          if (
            !refusedFor.has(workflow) &&
            !isWritten(written, workflow, { reference, checked, sha, key })
          ) {
            mismatches.push({ kind: 'not-on-disk', reference: name, workflow })
          }
        }
      }
      return mismatches
    })
    .toArray()
}

/**
 * Group the written updates by the reference they wrote, with the workflows the
 * lockfile records the files they were written to under. An update that names
 * no reference or no repository is left out.
 *
 * @param target - What the lockfile was regenerated for.
 * @returns Each reference by its key, in the order of the updates.
 */
function groupWritten(
  target: Pick<RelockTarget, 'updates' | 'files'>,
): Map<string, WrittenReference> {
  let written = new Map<string, WrittenReference>()
  for (let update of target.updates) {
    let reference = update.targetRef ?? update.latestSha
    let [owner, repository] = update.action.name.split('/', 2)
    if (reference && owner && repository) {
      let key = `${`${owner}/${repository}`.toLowerCase()}@${reference}`
      let entry = written.get(key) ?? {
        name: `${owner}/${repository}@${reference}`,
        checked: update.latestSha?.toLowerCase(),
        workflows: new Set<string>(),
        reference,
        key,
      }
      entry.workflows = entry.workflows.union(
        new Set(target.files.get(update.action.file!)),
      )
      written.set(key, entry)
    }
  }
  return written
}

/**
 * Tell whether the lockfile on disk pins a reference for a workflow at the
 * commit gh-actions-lock reported: under its key, or under the new name of its
 * repository with the same reference at the checked commit.
 *
 * @param written - What the lockfile on disk records.
 * @param workflow - Workflow, as the lockfile names it.
 * @param pin - The reference, and the commits it was checked and reported at.
 * @param pin.key - Key the lockfile pins it under, with the repository in lower
 *   case.
 * @param pin.reference - Reference, as written after `@`.
 * @param pin.checked - Commit the plan checked for it, when it is known.
 * @param pin.sha - Commit gh-actions-lock reported for it.
 * @returns True when the workflow pins the reference at that commit.
 */
function isWritten(
  written: WrittenLockfile,
  workflow: string,
  pin: {
    checked: undefined | string
    reference: string
    sha: string
    key: string
  },
): boolean {
  let keys = written.pins.get(workflow) ?? []
  let found =
    keys.includes(pin.key) ?
      pin.key
    : keys.find(
        key =>
          key.slice(key.indexOf('@') + 1) === pin.reference &&
          written.commits.get(key) === pin.checked,
      )
  return found !== undefined && written.commits.get(found) === pin.sha
}
