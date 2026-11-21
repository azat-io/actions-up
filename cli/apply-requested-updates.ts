import type { ActionUpdate } from '../types/action-update'
import type { LockedFile } from '../types/locked-file'

import { printUnwrittenWarning } from './print-unwritten-warning'
import { writeUpdates } from '../core/ast/update/apply-updates'
import { regenerateLockfiles } from './regenerate-lockfiles'
import { planRelocks } from '../core/lockfile/plan-relocks'
import { ignoreOutputErrors } from './ignore-output-errors'
import { holdStopSignals } from './hold-stop-signals'
import { colors } from '../core/interactive/colors'

/**
 * Write the updates the run applies, regenerate the workflow lockfiles they
 * leave stale, and say how it went.
 *
 * A stop signal waits for the writes and for the regeneration of the lockfiles
 * they leave stale, so that the notices can name what it left undone. So does
 * an output that is gone, as when its reader quit, once an update a workflow
 * lockfile pins is to be written; without one, nothing is left stale, and such
 * an output ends the run as it always did. The workflow lockfiles that pin
 * written entries are regenerated, and the files of a lockfile that could not
 * be are put back when that is safe.
 *
 * An entry the writer could not find where the scan reported it was not
 * applied, and neither was one whose file was put back because its lockfile
 * could not be regenerated, or could not be put back and may be cut short, so
 * the run reports them and fails instead of claiming success. A signal that
 * stopped the run is named, to explain its exit code, which is set for any run
 * that did not apply everything.
 *
 * @param requested - Updates to apply, as the user chose them.
 * @param lockedFiles - Scanned files whose actions lockfiles pin, with the
 *   lockfiles that pin them.
 */
export async function applyRequestedUpdates(
  requested: ActionUpdate[],
  lockedFiles: Map<string, LockedFile[]>,
): Promise<void> {
  if (planRelocks(lockedFiles, requested).length > 0) {
    ignoreOutputErrors()
  }
  let signals = holdStopSignals()
  let outcome: {
    relock: Awaited<ReturnType<typeof regenerateLockfiles>>
    unwritten: ActionUpdate[]
    written: ActionUpdate[]
  }
  try {
    let { unwritten, files } = await writeUpdates(requested)
    let written = requested.filter(update => !unwritten.includes(update))
    let relock = await regenerateLockfiles(
      planRelocks(lockedFiles, written),
      files,
      signals,
    )
    outcome = { unwritten, written, relock }
  } finally {
    signals.release()
  }

  let { unwritten, written, relock } = outcome
  if (unwritten.length === 0 && relock.exitCode === 0) {
    console.info(colors.green('\n✓ Updates applied successfully!'))
    return
  }

  let writtenCount = written.filter(
    ({ action }) =>
      !relock.restored.has(action.file!) &&
      !relock.unrestored.has(action.file!),
  ).length
  if (writtenCount > 0) {
    let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
    let noun =
      pluralRules.select(requested.length) === 'one' ? 'entry' : 'entries'
    console.info(
      colors.green(
        `\n✓ ${writtenCount} of ${requested.length} ${noun} applied`,
      ),
    )
  }
  printUnwrittenWarning(unwritten, requested.length)
  if (signals.signal !== null) {
    console.error(colors.yellow(`\n⚠️ Interrupted by ${signals.signal}`))
  }
  process.exitCode = Math.max(relock.exitCode, 1)
}
