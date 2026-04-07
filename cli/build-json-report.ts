import { isAbsolute, relative, resolve } from 'node:path'

import type { ActionUpdate } from '../types/action-update'
import type { ScanResult } from '../types/scan-result'
import type { UpdateMode } from '../types/update-mode'

/**
 * High-level status of a JSON report.
 */
export type JsonReportStatus =
  | 'updates-available'
  | 'no-actions-found'
  | 'nothing-to-check'
  | 'up-to-date'

/**
 * Options used to build a JSON report from the current CLI state.
 */
interface BuildJsonReportOptions {
  /**
   * Updates excluded by the selected update mode.
   */
  blockedByMode: ActionUpdate[]

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
   * Whether recursive scanning mode is enabled.
   */
  recursive: boolean

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
 * Serialized update entry in the JSON report.
 */
interface JsonReportUpdate {
  /**
   * Reason why this entry was skipped, if any.
   */
  skipReason: ActionUpdate['skipReason'] | null

  /**
   * Processing status for this entry.
   */
  status: NonNullable<ActionUpdate['status']>

  /**
   * Version currently used in the workflow or action file.
   */
  currentVersion: string | null

  /**
   * Latest version found for this dependency.
   */
  latestVersion: string | null

  /**
   * Release publication date in ISO format.
   */
  publishedAt: string | null

  /**
   * Original action reference metadata.
   */
  action: JsonReportAction

  /**
   * Resolved SHA for the target version.
   */
  latestSha: string | null

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
 * Aggregate counts included in the JSON report.
 */
interface JsonReportSummary {
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
   * Number of updates filtered out by `--mode`.
   */
  totalBlockedByMode: number

  /**
   * Number of workflows discovered during scanning.
   */
  totalWorkflows: number

  /**
   * Total number of action references found during scanning.
   */
  totalActions: number

  /**
   * Number of skipped entries in the report.
   */
  totalSkipped: number

  /**
   * Number of actionable updates in the report.
   */
  totalUpdates: number
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
   * Original `uses` value, if available.
   */
  uses: string | null

  /**
   * Workflow job name, when applicable.
   */
  job: string | null

  /**
   * Full `owner/repo@ref` string, when available.
   */
  ref: string | null

  /**
   * Normalized action name.
   */
  name: string
}

/**
 * Effective CLI options serialized into the report.
 */
interface JsonReportOptions {
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
   * Whether recursive scanning mode is enabled.
   */
  recursive: boolean

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
 * Top-level machine-readable report emitted by `--json`.
 */
interface JsonReport {
  /**
   * Entries filtered out by the selected update mode.
   */
  blockedByMode: JsonReportUpdate[]

  /**
   * Entries skipped during update checks.
   */
  skipped: JsonReportUpdate[]

  /**
   * Actionable updates after filtering.
   */
  updates: JsonReportUpdate[]

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
  schemaVersion: 1
}

/**
 * Build the machine-readable JSON report returned by `--json`.
 *
 * @param options - Current CLI state and computed update data.
 * @returns Serializable JSON payload for stdout.
 */
export function buildJsonReport(options: BuildJsonReportOptions): JsonReport {
  let cwd = resolve(options.cwd ?? process.cwd())

  return {
    summary: {
      totalBreakingUpdates: options.outdated.filter(update => update.isBreaking)
        .length,
      totalCompositeActions: options.scanResult.compositeActions.size,
      totalWorkflows: options.scanResult.workflows.size,
      totalActionsChecked: options.actionsToCheckCount,
      totalBlockedByMode: options.blockedByMode.length,
      totalActions: options.scanResult.actions.length,
      totalUpdates: options.outdated.length,
      totalSkipped: options.skipped.length,
    },
    options: {
      directories: options.directories.map(directory =>
        serializeDirectoryPath(directory, cwd),
      ),
      excludePatterns: options.excludePatterns,
      includeBranches: options.includeBranches,
      recursive: options.recursive,
      minAge: options.minAge,
      mode: options.mode,
      reportOnly: true,
      json: true,
    },
    blockedByMode: options.blockedByMode.map(update =>
      serializeUpdate(update, cwd),
    ),
    updates: options.outdated.map(update => serializeUpdate(update, cwd)),
    skipped: options.skipped.map(update => serializeUpdate(update, cwd)),
    status: options.status,
    schemaVersion: 1,
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
    publishedAt: update.publishedAt?.toISOString() ?? null,
    currentVersion: update.currentVersion,
    skipReason: update.skipReason ?? null,
    latestVersion: update.latestVersion,
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
