import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import type { RelockTarget } from '../types/relock-target'
import type { HeldSignals } from '../types/held-signals'
import type { PinMismatch } from '../types/pin-mismatch'
import type { LockFinding } from '../types/lock-finding'
import type { WrittenFile } from '../types/written-file'

import {
  formatRelockCommand,
  relockWorkflows,
} from '../core/lockfile/relock-workflows'
import { findPinMismatches } from '../core/lockfile/find-pin-mismatches'
import { restoreWrittenFiles } from '../core/fs/restore-written-files'
import { parseLockfile } from '../core/lockfile/parse-lockfile'
import { printRelockNotice } from './print-relock-notice'
import { createSpinner } from './create-spinner'

/**
 * Exit codes shells report for a process that a signal ended.
 */
const SIGNAL_EXIT_CODES: Record<NonNullable<HeldSignals['signal']>, number> = {
  SIGTERM: 143,
  SIGINT: 130,
}

/**
 * What the regeneration of one lockfile did.
 */
interface Outcome {
  /**
   * Whether the lockfile was regenerated as checked.
   */
  regenerated: boolean

  /**
   * Written files that could not be put back, which may be cut short.
   */
  unrestored: string[]

  /**
   * Written files put back the way they were.
   */
  restored: string[]
}

/**
 * How the regeneration runs.
 */
interface Run {
  /**
   * Files the updater rewrote, with their text before and after.
   */
  written: WrittenFile[]

  /**
   * Stop signal held back so far.
   */
  signals: HeldSignals
}

/**
 * Regenerate the workflow lockfiles that pin written files, one after another.
 *
 * A lockfile counts as regenerated only when gh-actions-lock exits with success
 * and the lockfile pins every written reference, for each workflow, to the
 * commit Actions Up checked, or to the one it already pinned the reference to,
 * which a notice names. Otherwise the workflows it tracks would run something
 * else than the run announced, or fail to start. When the tool exited on its
 * own and left the lockfile as it was, the written files are put back to match
 * it again, each only while it still holds what was written. The run never
 * writes a lockfile: once the tool changed one, what it wrote is known only
 * from the disk, where another writer may have changed it too, so the files
 * stay with it, and the notice says what it does not pin as checked. The plan
 * skips files that more than one lockfile pins, so each lockfile is regenerated
 * for files of its own.
 *
 * The caller holds stop signals back from the time the files are written. The
 * first SIGINT or SIGTERM keeps `gh` from starting again and stops the
 * regeneration once the current `gh` run ends: Ctrl+C in a terminal stops that
 * run too, while a signal sent to the CLI alone lets it finish. After a signal
 * nothing is put back, except for files already being put back, as stopping
 * halfway would leave their lockfile matching only some of them: the notices
 * name each lockfile that may not match its files, with the command that
 * regenerates it.
 *
 * @param targets - Lockfiles to regenerate, with the workflows, the written
 *   files and the written updates each is regenerated for; every such file is
 *   one of `written`.
 * @param written - Files the updater rewrote, with their text before and after.
 * @param signals - Stop signal held back since the files were written.
 * @returns Paths of the files put back, and of the files that could not be, as
 *   the scan names them, and the exit code of the run: 0 when every lockfile
 *   was regenerated as checked, 1 when one was not, and the code of a signal
 *   that stopped the run.
 */
export async function regenerateLockfiles(
  targets: RelockTarget[],
  written: WrittenFile[],
  signals: HeldSignals,
): Promise<{
  unrestored: Set<string>
  restored: Set<string>
  exitCode: number
}> {
  /**
   * Each lockfile is regenerated only once the one before is done.
   */
  let outcomes = await Array.fromAsync(targets, target =>
    regenerate(target, { written, signals }),
  )

  let { signal } = signals
  let failed = outcomes.some(({ regenerated }) => !regenerated)
  return {
    exitCode: signal === null ? Number(failed) : SIGNAL_EXIT_CODES[signal],
    unrestored: new Set(outcomes.flatMap(({ unrestored }) => unrestored)),
    restored: new Set(outcomes.flatMap(({ restored }) => restored)),
  }
}

/**
 * Regenerate one lockfile and check what it pins.
 *
 * @param target - Lockfile to regenerate, with what for.
 * @param run - How the regeneration runs.
 * @param run.before - Bytes of the lockfile before the relock, null when it
 *   could not be read.
 * @returns What the regeneration of the lockfile did.
 */
async function relockAndCheck(
  target: RelockTarget,
  run: { before: Buffer | null } & Run,
): Promise<Outcome> {
  let { written, signals, before } = run
  let lockfile = toDisplayPath(target.lockfile.path)

  /**
   * A signal does not end the process here, so that the notice can say what
   * became of the files.
   */
  let spinner = createSpinner(`Regenerating ${lockfile}...`, {
    exitOnSignal: false,
  }).start()
  let result = await relockWorkflows(target.lockfile, target.workflows)
  let mismatches =
    result.kind === 'relocked' ?
      findPinMismatches(target, result, readRecordedCommits(before))
    : []

  /**
   * A reference that keeps the commit the lockfile pinned before matches its
   * files, so the lockfile counts as regenerated, but the notice names it: it
   * runs another commit than the one the run announced.
   */
  let kept = mismatches.filter(({ kind }) => kind === 'kept-commit')
  if (result.kind === 'relocked' && kept.length === mismatches.length) {
    spinner.success(`Regenerated ${lockfile}`)
    if (kept.length > 0) {
      printRelockNotice({
        heading: `gh actions-lock kept earlier pins in ${lockfile}`,
        details: kept.map(describeMismatch),
        unrestored: [],
        command: null,
        restored: [],
        left: [],
      })
    }
    return { regenerated: true, unrestored: [], restored: [] }
  }

  /**
   * A signal that ended `gh` without reaching the CLI came from elsewhere, so
   * the run goes on.
   */
  if (result.kind === 'stopped') {
    let stopped = signals.signal !== null
    spinner.error(
      stopped ?
        `Stopped regenerating ${lockfile}`
      : `Could not regenerate ${lockfile}`,
    )
    return stop(
      target,
      written,
      stopped ? 'Stopped' : `gh actions-lock was ended by ${result.signal}`,
    )
  }

  spinner.error(
    result.kind === 'relocked' ?
      `Regenerated ${lockfile}, but not as checked`
    : `Could not regenerate ${lockfile}`,
  )

  /**
   * The tool exited on its own, so it is done writing. The files match a
   * lockfile it left as it was once they are put back, unless the run was
   * stopped meanwhile: nothing is put back after a signal that came before this
   * check, while one that comes later lets the files being put back finish. A
   * lockfile that could not be read, before or after, may have changed, so
   * nothing is put back for it either.
   */
  let after = await readBytes(target.lockfile.path)
  let unchanged = before !== null && after !== null && before.equals(after)
  let restore = unchanged && signals.signal === null

  if (result.kind === 'failed') {
    return finish(target, written, {
      heading: `gh actions-lock did not regenerate ${lockfile}: ${result.reason}`,
      details: result.findings.map(describeFinding),
      rerun: true,
      restore,
    })
  }

  /**
   * Running the relock again pins the same, so the notice gives no command.
   */
  return finish(target, written, {
    heading: `gh actions-lock did not pin what Actions Up checked in ${lockfile}`,
    details: mismatches.map(describeMismatch),
    rerun: false,
    restore,
  })
}

/**
 * Put back the written files of a lockfile that was not regenerated as checked,
 * when that is safe, and say what became of them.
 *
 * @param target - Lockfile that was not regenerated as checked.
 * @param written - Files the updater rewrote, with their text before and after.
 * @param notice - What to say, and whether to put the files back.
 * @param notice.heading - What went wrong, in one line.
 * @param notice.details - Findings or references that explain it.
 * @param notice.restore - Whether the files can be put back.
 * @param notice.rerun - Whether running the relock again may regenerate the
 *   lockfile for the files that keep their updates, so that the notice gives
 *   the command; false when it would pin the same again.
 * @returns What the regeneration of the lockfile did.
 */
async function finish(
  target: RelockTarget,
  written: WrittenFile[],
  notice: {
    details: string[]
    restore: boolean
    heading: string
    rerun: boolean
  },
): Promise<Outcome> {
  let files = written.filter(file => target.files.has(file.path))
  let { restored, failed } =
    notice.restore ?
      await restoreWrittenFiles(files)
    : { failed: new Map<string, string>(), restored: [] }

  printRelockNotice({
    command:
      notice.rerun ?
        formatRelockCommand(
          target.workflows,
          toDisplayPath(target.lockfile.root),
        )
      : null,
    left: files
      .filter(file => !restored.includes(file.path) && !failed.has(file.path))
      .map(file => toDisplayPath(file.path)),
    unrestored: failed
      .entries()
      .map(([path, error]) => `${toDisplayPath(path)}: ${error}`)
      .toArray(),
    restored: restored.map(toDisplayPath),
    details: notice.details,
    heading: notice.heading,
  })

  return { unrestored: failed.keys().toArray(), regenerated: false, restored }
}

/**
 * Describe a reference the lockfile does not pin as checked, with what fixes
 * it.
 *
 * @param mismatch - The reference and what the lockfile pins for it.
 * @returns The description.
 */
function describeMismatch(mismatch: PinMismatch): string {
  if (mismatch.kind === 'refused') {
    return `${mismatch.reference} is not pinned for ${mismatch.workflow}: its entry in the lockfile did not track the action, and gh actions-lock adds it only without --no-onboard`
  }
  if (mismatch.kind === 'missing') {
    return `${mismatch.reference} is not pinned: gh actions-lock left it out of the lockfile`
  }
  let pinned = mismatch.pinned.slice(0, 7)
  let checked = mismatch.checked.slice(0, 7)
  return mismatch.kind === 'kept-commit' ?
      `${mismatch.reference} stays pinned to ${pinned}, which the lockfile pinned before, not to the checked ${checked}; gh actions-lock --relock moves it forward`
    : `${mismatch.reference} is pinned to ${pinned}, not to the checked ${checked}: it moved after Actions Up checked it, so the pinned commit skipped the cool-down and trust checks; review it, or undo the changes with Git`
}

/**
 * Say that a lockfile may not match its files, since the run or `gh` was
 * stopped before it was regenerated.
 *
 * @param target - Lockfile left as it is, with what for.
 * @param written - Files the updater rewrote, with their text before and after.
 * @param cause - What was stopped, and how, as the notice begins.
 * @returns What the regeneration of the lockfile did.
 */
function stop(
  target: RelockTarget,
  written: WrittenFile[],
  cause: string,
): Promise<Outcome> {
  return finish(target, written, {
    heading: `${cause}, so ${toDisplayPath(target.lockfile.path)} may not match the updated files`,
    restore: false,
    rerun: true,
    details: [],
  })
}

/**
 * Describe a finding of gh-actions-lock in one line, with the guide section
 * that explains it.
 *
 * @param finding - Finding that blocked the lockfile.
 * @returns The description.
 */
function describeFinding(finding: LockFinding): string {
  let place = finding.workflow ? `${finding.workflow}: ` : ''
  let kind = finding.category ? ` (${finding.category})` : ''
  let guide = finding.docUrl ? `\n     ${finding.docUrl}` : ''
  return `${place}${finding.detail}${kind}${guide}`
}

/**
 * Regenerate one lockfile, unless the run was stopped before.
 *
 * The lockfile is read before the last look at the signal, so that nothing is
 * awaited between that look and the start of `gh`.
 *
 * @param target - Lockfile to regenerate, with what for.
 * @param run - How the regeneration runs.
 * @returns What the regeneration of the lockfile did.
 */
async function regenerate(target: RelockTarget, run: Run): Promise<Outcome> {
  let before = await readBytes(target.lockfile.path)
  return run.signals.signal === null ?
      relockAndCheck(target, { ...run, before })
    : stop(target, run.written, 'Stopped')
}

/**
 * Read the commit a lockfile pinned each reference to before the relock.
 *
 * @param bytes - Bytes of the lockfile, null when it could not be read.
 * @returns The commits in lower case, by `owner/repo@ref` with the repository
 *   in lower case; none when the lockfile cannot be read.
 */
function readRecordedCommits(bytes: Buffer | null): Map<string, string> {
  let parsed = bytes === null ? null : parseLockfile(bytes.toString('utf8'))
  return parsed?.kind === 'parsed' ? parsed.commits : new Map<string, string>()
}

/**
 * Read the bytes of a file, so that a change to any of them shows.
 *
 * @param path - Absolute path of the file.
 * @returns The bytes, or null when the file cannot be read.
 */
async function readBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

/**
 * Name a file the way the CLI shows paths.
 *
 * @param path - Absolute path of the file.
 * @returns Its path from the working directory.
 */
function toDisplayPath(path: string): string {
  return relative(process.cwd(), path)
}
