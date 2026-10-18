import { isAbsolute, relative, resolve } from 'node:path'

import type { UpdatePlanStatus } from '../types/update-plan'
import type { ActionUpdate } from '../types/action-update'
import type { UpdateStyle } from '../types/update-style'
import type { ScanResult } from '../types/scan-result'
import type { UpdateMode } from '../types/update-mode'
import type { TrustHold } from '../types/trust-hold'

/**
 * High-level status of a JSON report, the status of the plan it reports.
 */
export type JsonReportStatus = UpdatePlanStatus

/**
 * Serialized update entry in the JSON report.
 */
interface JsonReportUpdate {
  /**
   * Style of the final reference.
   */
  targetRefStyle: NonNullable<ActionUpdate['targetRefStyle']> | null

  /**
   * Why the entry was held back, null outside the held-back lists.
   */
  holdReason: NonNullable<ActionUpdate['holdReason']> | null

  /**
   * Where `effectiveDate` came from: `release` or `branch`.
   */
  ageSource: NonNullable<ActionUpdate['ageSource']> | null

  /**
   * Detected style of the current reference in the source file.
   */
  currentRefType: ActionUpdate['currentRefType'] | null

  /**
   * Reason why this entry was skipped, if any.
   */
  skipReason: ActionUpdate['skipReason'] | null

  /**
   * Processing status for this entry.
   */
  status: NonNullable<ActionUpdate['status']>

  /**
   * Whether the latest version has an immutable release, whose tag cannot have
   * been moved since it was published; null when the release was not read.
   */
  immutableRelease: boolean | null

  /**
   * Version currently used in the workflow or action file.
   */
  currentVersion: string | null

  /**
   * True when a rate limit kept the floating tag from being validated, so the
   * exact latest version is the target instead.
   */
  targetRefRateLimited: boolean

  /**
   * Latest version found for this dependency.
   */
  latestVersion: string | null

  /**
   * Moment from which GitHub's records show the commit of the latest version
   * public, in ISO format; null when the cool-down did not apply or no such
   * moment was established.
   */
  effectiveDate: string | null

  /**
   * Publication date of the release of the latest version in ISO format, null
   * when it has none or it was not looked up.
   */
  publishedAt: string | null

  /**
   * Original action reference metadata.
   */
  action: JsonReportAction

  /**
   * Commit the tag of the latest version points at, read from the tag
   * reference.
   */
  latestSha: string | null

  /**
   * Final reference that would be written back to the file.
   */
  targetRef: string | null

  /**
   * Tags held back because their commit failed a trust check, newest first.
   */
  trustHolds: TrustHold[]

  /**
   * Whether this update crosses a major version boundary.
   */
  isBreaking: boolean

  /**
   * Whether an update is available for this entry.
   */
  hasUpdate: boolean
}

/**
 * Options used to build a JSON report from the current CLI state.
 */
interface BuildJsonReportOptions {
  /**
   * Updates held back because they would move a SHA pin to an older version
   * than its version comment names.
   */
  blockedAsDowngrade: ActionUpdate[]

  /**
   * Regex patterns supplied through `--min-age-exclude`.
   */
  minAgeExcludePatterns: string[]

  /**
   * Updates held back because their commit failed a trust check.
   */
  blockedByTrust: ActionUpdate[]

  /**
   * Updates excluded by the selected update mode.
   */
  blockedByMode: ActionUpdate[]

  /**
   * Updates held back by the release age cool-down.
   */
  blockedByAge: ActionUpdate[]

  /**
   * Number of actions that were actually checked after excludes.
   */
  actionsToCheckCount: number

  /**
   * Regex patterns supplied through `--exclude`.
   */
  excludePatterns: string[]

  /**
   * Whether branch references were included in update checks.
   */
  includeBranches: boolean

  /**
   * Updates that remain actionable after all filters.
   */
  outdated: ActionUpdate[]

  /**
   * Final report status.
   */
  status: JsonReportStatus

  /**
   * Updates skipped during processing, such as branch references.
   */
  skipped: ActionUpdate[]

  /**
   * Aggregate scan result for the current run.
   */
  scanResult: ScanResult

  /**
   * Directories resolved for scanning.
   */
  directories: string[]

  /**
   * Whether tags were inspected alongside releases.
   */
  preferTags: boolean

  /**
   * Whether recursive scanning mode is enabled.
   */
  recursive: boolean

  /**
   * Effective update style for the run.
   */
  style: UpdateStyle

  /**
   * Effective update mode for the run.
   */
  mode: UpdateMode

  /**
   * Minimum age filter in days.
   */
  minAge: number

  /**
   * Working directory used for relative path normalization.
   */
  cwd?: string
}

/**
 * Aggregate counts included in the JSON report.
 */
interface JsonReportSummary {
  /**
   * Number of updates held back as downgrades of SHA pins.
   */
  totalBlockedAsDowngrade: number

  /**
   * Number of composite actions discovered during scanning.
   */
  totalCompositeActions: number

  /**
   * Number of breaking updates among actionable updates.
   */
  totalBreakingUpdates: number

  /**
   * Number of actions checked after excludes.
   */
  totalActionsChecked: number

  /**
   * Number of updates held back because their commit failed a trust check.
   */
  totalBlockedByTrust: number

  /**
   * Number of updates filtered out by `--mode`.
   */
  totalBlockedByMode: number

  /**
   * Number of actionable runner label updates in the report.
   */
  totalRunnerUpdates: number

  /**
   * Number of updates held back by `--min-age`.
   */
  totalBlockedByAge: number

  /**
   * Number of tags that failed a trust check, one per tag of each entry: on
   * updates held back for it, and on updates that stepped down past them to an
   * older version. A run with no security finding reports zero.
   */
  totalTrustHolds: number

  /**
   * Number of workflows discovered during scanning.
   */
  totalWorkflows: number

  /**
   * Total number of action references found during scanning.
   */
  totalActions: number

  /**
   * Total number of `runs-on` labels found during scanning.
   */
  totalRunners: number

  /**
   * Number of skipped entries in the report.
   */
  totalSkipped: number

  /**
   * Number of actionable updates in the report, runners excluded.
   */
  totalUpdates: number
}

/**
 * Top-level machine-readable report emitted by `--json`.
 */
interface JsonReport {
  /**
   * Entries held back because they would downgrade a SHA pin.
   */
  blockedAsDowngrade: JsonReportUpdate[]

  /**
   * Entries held back because the commit their tag points at failed a trust
   * check: a tag moved after its release, or a commit outside the history of
   * the repository.
   */
  blockedByTrust: JsonReportUpdate[]

  /**
   * Entries filtered out by the selected update mode.
   */
  blockedByMode: JsonReportUpdate[]

  /**
   * Entries held back by the release age cool-down, including those whose date
   * could not be established.
   */
  blockedByAge: JsonReportUpdate[]

  /**
   * Entries skipped during update checks.
   */
  skipped: JsonReportUpdate[]

  /**
   * Actionable updates after filtering.
   */
  updates: JsonReportUpdate[]

  /**
   * Actionable updates for the scanned `runs-on` labels.
   *
   * Kept apart from `updates` so that consumers gating on `totalUpdates` keep
   * measuring action updates alone.
   */
  runners: JsonReportUpdate[]

  /**
   * Effective options that shaped the report.
   */
  options: JsonReportOptions

  /**
   * Aggregate counts for the current run.
   */
  summary: JsonReportSummary

  /**
   * Overall outcome for the current run.
   */
  status: JsonReportStatus

  /**
   * Version of the JSON payload schema.
   */
  schemaVersion: 2
}

/**
 * Effective CLI options serialized into the report.
 */
interface JsonReportOptions {
  /**
   * Regex patterns supplied through `--min-age-exclude`.
   */
  minAgeExcludePatterns: string[]

  /**
   * Regex patterns supplied through `--exclude`.
   */
  excludePatterns: string[]

  /**
   * Whether branch references were checked.
   */
  includeBranches: boolean

  /**
   * Resolved scan directories.
   */
  directories: string[]

  /**
   * Whether tags were inspected alongside releases.
   */
  preferTags: boolean

  /**
   * Whether recursive scanning mode is enabled.
   */
  recursive: boolean

  /**
   * Effective update style.
   */
  style: UpdateStyle

  /**
   * Effective update mode.
   */
  mode: UpdateMode

  /**
   * Indicates that JSON mode never applies changes.
   */
  reportOnly: true

  /**
   * Minimum age filter in days.
   */
  minAge: number

  /**
   * Indicates that this payload came from `--json`.
   */
  json: true
}

/**
 * Serialized action reference included in each update entry.
 */
interface JsonReportAction {
  /**
   * Action reference type detected during scanning.
   */
  type: ActionUpdate['action']['type']

  /**
   * Original version or ref from the file, if available.
   */
  version: string | null

  /**
   * Relative or absolute file path for the action reference.
   */
  file: string | null

  /**
   * Line number of the action reference.
   */
  line: number | null

  /**
   * The `uses` value as written; null for runner labels.
   */
  uses: string | null

  /**
   * Workflow job name, when applicable.
   */
  job: string | null

  /**
   * Repository and ref as `owner/repo@ref`, without the path of an action
   * inside the repository; null for local, Docker and runner entries.
   */
  ref: string | null

  /**
   * Normalized action name.
   */
  name: string
}

/**
 * Machine-readable report emitted by `--json` when the run fails.
 */
interface JsonErrorReport {
  /**
   * Why the run failed.
   */
  error: {
    /**
     * Whether GitHub refused further requests because a rate limit was
     * exhausted.
     */
    rateLimited: boolean

    /**
     * Reason the run failed, worded as in the terminal.
     */
    message: string
  }

  /**
   * Version of the JSON payload schema.
   */
  schemaVersion: 2

  /**
   * Marks a run that failed before it could report updates.
   */
  status: 'error'
}

/**
 * Build the machine-readable JSON report returned by `--json`.
 *
 * @param options - Current CLI state and computed update data.
 * @returns Serializable JSON payload for stdout.
 */
export function buildJsonReport(options: BuildJsonReportOptions): JsonReport {
  let cwd = resolve(options.cwd ?? process.cwd())

  /**
   * Runner labels travel alongside actions from the scan onwards, but they are
   * a different kind of entry, so the report keeps them apart.
   */
  let runnerUpdates = options.outdated.filter(update => isRunnerUpdate(update))
  let actionUpdates = options.outdated.filter(update => !isRunnerUpdate(update))
  let scannedRunners = options.scanResult.actions.filter(action =>
    isRunnerAction(action),
  )

  return {
    summary: {
      totalTrustHolds: [...options.blockedByTrust, ...options.outdated].reduce(
        (total, update) => total + (update.trustHolds?.length ?? 0),
        0,
      ),
      totalBreakingUpdates: actionUpdates.filter(update => update.isBreaking)
        .length,
      totalActions: options.scanResult.actions.length - scannedRunners.length,
      totalCompositeActions: options.scanResult.compositeActions.size,
      totalBlockedAsDowngrade: options.blockedAsDowngrade.length,
      totalBlockedByTrust: options.blockedByTrust.length,
      totalWorkflows: options.scanResult.workflows.size,
      totalActionsChecked: options.actionsToCheckCount,
      totalBlockedByMode: options.blockedByMode.length,
      totalBlockedByAge: options.blockedByAge.length,
      totalRunnerUpdates: runnerUpdates.length,
      totalSkipped: options.skipped.length,
      totalRunners: scannedRunners.length,
      totalUpdates: actionUpdates.length,
    },
    options: {
      directories: options.directories.map(directory =>
        serializeDirectoryPath(directory, cwd),
      ),
      minAgeExcludePatterns: options.minAgeExcludePatterns,
      excludePatterns: options.excludePatterns,
      includeBranches: options.includeBranches,
      preferTags: options.preferTags,
      recursive: options.recursive,
      minAge: options.minAge,
      style: options.style,
      mode: options.mode,
      reportOnly: true,
      json: true,
    },
    blockedAsDowngrade: options.blockedAsDowngrade.map(update =>
      serializeUpdate(update, cwd),
    ),
    blockedByTrust: options.blockedByTrust.map(update =>
      serializeUpdate(update, cwd),
    ),
    blockedByMode: options.blockedByMode.map(update =>
      serializeUpdate(update, cwd),
    ),
    blockedByAge: options.blockedByAge.map(update =>
      serializeUpdate(update, cwd),
    ),
    skipped: options.skipped.map(update => serializeUpdate(update, cwd)),
    updates: actionUpdates.map(update => serializeUpdate(update, cwd)),
    runners: runnerUpdates.map(update => serializeUpdate(update, cwd)),
    status: options.status,
    schemaVersion: 2,
  }
}

/**
 * Build the machine-readable report `--json` prints when the run fails.
 *
 * A failed run has no update lists to report, but a consumer that parses the
 * output still gets a document, together with the reason, instead of empty
 * output.
 *
 * @param error - Error the run failed with.
 * @returns Serializable JSON payload for stdout.
 */
export function buildJsonErrorReport(error: unknown): JsonErrorReport {
  return {
    error: {
      rateLimited:
        error instanceof Error && error.name === 'GitHubRateLimitError',
      message: error instanceof Error ? error.message : String(error),
    },
    schemaVersion: 2,
    status: 'error',
  }
}

/**
 * Convert an internal update entry to its JSON-safe representation.
 *
 * @param update - Update entry from the core pipeline.
 * @param cwd - Base directory used to relativize paths.
 * @returns Serialized update object.
 */
function serializeUpdate(update: ActionUpdate, cwd: string): JsonReportUpdate {
  return {
    action: {
      file: serializePath(update.action.file, cwd),
      version: update.action.version ?? null,
      line: update.action.line ?? null,
      uses: update.action.uses ?? null,
      job: update.action.job ?? null,
      ref: update.action.ref ?? null,
      name: update.action.name,
      type: update.action.type,
    },
    effectiveDate: update.effectiveDate?.toISOString() ?? null,
    targetRefRateLimited: update.targetRefRateLimited ?? false,
    publishedAt: update.publishedAt?.toISOString() ?? null,
    immutableRelease: update.immutableRelease ?? null,
    currentRefType: update.currentRefType ?? null,
    targetRefStyle: update.targetRefStyle ?? null,
    holdReason: update.holdReason ?? null,
    currentVersion: update.currentVersion,
    skipReason: update.skipReason ?? null,
    trustHolds: update.trustHolds ?? [],
    ageSource: update.ageSource ?? null,
    latestVersion: update.latestVersion,
    targetRef: update.targetRef ?? null,
    isBreaking: update.isBreaking,
    status: update.status ?? 'ok',
    hasUpdate: update.hasUpdate,
    latestSha: update.latestSha,
  }
}

/**
 * Normalize a file path for JSON output.
 *
 * Returns `null` for missing values, preserves relative paths as-is, and
 * converts absolute paths under `cwd` to relative ones.
 *
 * @param pathValue - Path to normalize.
 * @param cwd - Base directory used to relativize absolute paths.
 * @param emptyFallback - Fallback value when the path resolves exactly to
 *   `cwd`.
 * @returns Normalized path string or `null`.
 */
function serializePath(
  pathValue: undefined | string,
  cwd: string,
  emptyFallback: string | null = null,
): string | null {
  if (!pathValue) {
    return null
  }

  if (!isAbsolute(pathValue)) {
    return pathValue
  }

  let relativePath = relative(cwd, pathValue)
  if (relativePath === '') {
    return emptyFallback ?? pathValue
  }

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return pathValue
  }

  return relativePath
}

/**
 * Normalize a scan directory for JSON output.
 *
 * @param directory - Resolved directory path.
 * @param cwd - Base directory used to relativize absolute paths.
 * @returns Relative directory when possible, otherwise the original path.
 */
function serializeDirectoryPath(directory: string, cwd: string): string {
  let relativePath = relative(cwd, directory)
  if (relativePath === '') {
    return '.'
  }

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return directory
  }

  return relativePath
}

/**
 * Tell a scanned `runs-on` label apart from an action reference.
 *
 * @param action - Scanned entry from the core pipeline.
 * @returns True when the entry describes a runner label.
 */
function isRunnerAction(action: ActionUpdate['action']): boolean {
  return action.type === 'runner'
}

/**
 * Tell a runner label update apart from an action update.
 *
 * @param update - Update entry from the core pipeline.
 * @returns True when the entry describes a `runs-on` label.
 */
function isRunnerUpdate(update: ActionUpdate): boolean {
  return isRunnerAction(update.action)
}
