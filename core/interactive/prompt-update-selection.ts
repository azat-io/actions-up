import path from 'node:path'

import type { MultiselectEntry } from '../../types/multiselect-entry'
import type { ActionUpdate } from '../../types/action-update'

import { parseVersionComment } from '../versions/parse-version-comment'
import { runMultiselect } from './multiselect/run-multiselect'
import { formatVersion } from './format-version'
import { GITHUB_DIRECTORY } from '../constants'
import { isSha } from '../versions/is-sha'
import { stripAnsi } from './strip-ansi'
import { padString } from './pad-string'
import { colors } from './colors'

/**
 * Global minimum widths for the action and current version columns.
 */
const MIN_ACTION_WIDTH = 40

/**
 * Global minimum width for the job column.
 */
const MIN_JOB_WIDTH = 4

/**
 * Global minimum width for the current version column.
 */
const MIN_CURRENT_WIDTH = 16

/**
 * Maximum width for version padding before SHA hash.
 */
const MAX_VERSION_WIDTH = 7

/**
 * Intermediate representation for a row in the table before formatting.
 */
interface TableRow {
  /**
   * Current version rendered in the third column.
   */
  current: string

  /**
   * Action name rendered in the first column.
   */
  action: string

  /**
   * Target version rendered in the last column.
   */
  target: string

  /**
   * Arrow glyph placed between versions.
   */
  arrow: string

  /**
   * Job name rendered in the second column.
   */
  job: string

  /**
   * Age of the release (e.g., "2d", "3w").
   */
  age: string
}

interface FormatTableRowOptions {
  /**
   * Width for current version column.
   */
  currentWidth: number

  /**
   * Width for action column.
   */
  actionWidth: number

  /**
   * Width for target column.
   */
  targetWidth: number

  /**
   * Width for job column.
   */
  jobWidth: number

  /**
   * Width for age column (0 to hide).
   */
  ageWidth: number

  /**
   * Row data to format.
   */
  row: TableRow
}

interface GroupEntry {
  /**
   * Outdated update belonging to the group.
   */
  update: ActionUpdate

  /**
   * Index in the filtered outdated updates list.
   */
  index: number
}

interface PromptUpdateSelectionOptions {
  /**
   * Whether to show the Age column.
   */
  showAge?: boolean
}

export async function promptUpdateSelection(
  updates: ActionUpdate[],
  options: PromptUpdateSelectionOptions = {},
): Promise<ActionUpdate[] | null> {
  let { showAge = false } = options

  if (updates.length === 0) {
    return null
  }

  /**
   * Only outdated (hasUpdate). Items without a resolved target ref are shown
   * but disabled.
   */
  let outdated = updates.filter(update => update.hasUpdate)

  if (outdated.length === 0) {
    console.info(colors.green('✓ All actions are up to date!'))
    return null
  }

  /**
   * Group by files for user convenience.
   */
  let groups = new Map<string, GroupEntry[]>()

  /**
   * Files in the order the list shows their groups.
   */
  let sortedFiles: string[] = []

  for (let [index, update] of outdated.entries()) {
    let originalFile = update.action.file ?? 'unknown file'
    /**
     * Show relative path without .github directory.
     */
    let file = path.relative(
      path.join(process.cwd(), GITHUB_DIRECTORY),
      originalFile,
    )

    if (file === '') {
      file = originalFile
    }

    let group = groups.get(file)

    if (!group) {
      group = []
      groups.set(file, group)
      sortedFiles.push(file)
    }

    group.push({ update, index })
  }

  sortedFiles.sort()

  /**
   * Resolve display value for Current and an effective version for diffing. If
   * the current ref is a SHA and we previously pinned with a version comment
   * (e.g. "# v5.0.0"), show that version instead of the SHA and use it for diff
   * coloring in the Target column.
   */
  let currentComputedByIndex = outdated.map(update => {
    let display = formatVersionOrSha(update.currentVersion)
    let effectiveForDiff: undefined | string =
      update.currentVersion ?? undefined
    let versionForPadding: string | null = null
    let shortSha: string | null = null

    if (!update.currentVersion || !isSha(update.currentVersion)) {
      return { versionForPadding, effectiveForDiff, shortSha, display }
    }

    let versionFromComment = parseVersionComment(update.action.comment)

    if (versionFromComment) {
      shortSha = update.currentVersion.slice(0, 7)
      versionForPadding = formatVersionOrSha(versionFromComment)
      display = versionForPadding
      effectiveForDiff = versionFromComment
    }

    return { versionForPadding, effectiveForDiff, shortSha, display }
  })

  /**
   * Lines of the list: a label per file, followed by the column header and the
   * rows of its updates, and a blank line between files. The rows of updates
   * that can be applied and are not breaking are selected at the start.
   */
  let entries: MultiselectEntry<number>[] = []

  let maxActionLength = stripAnsi('Action').length
  let maxCurrentLength = stripAnsi('Current').length
  let maxJobLength = stripAnsi('Job').length
  let maxVersionLength = 0
  let hasAnyAge = false

  for (let [index, update] of outdated.entries()) {
    let actionNameRaw = update.action.name
    let currentComputed = currentComputedByIndex[index]!
    let currentRaw = currentComputed.display
    let jobRaw = update.action.job ?? '–'
    maxActionLength = Math.max(maxActionLength, actionNameRaw.length)
    maxCurrentLength = Math.max(
      maxCurrentLength,
      stripAnsi(currentRaw).length,
      currentComputed.versionForPadding && currentComputed.shortSha ?
        stripAnsi(
          `${padString(
            currentComputed.versionForPadding,
            maxVersionLength + 1,
          )}${colors.gray(`(${currentComputed.shortSha})`)}`,
        ).length
      : 0,
    )
    maxJobLength = Math.max(maxJobLength, jobRaw.length)
    if (update.latestVersion) {
      let targetVersion =
        update[
          update.targetRefStyle === 'tag' && update.targetRef ?
            'targetRef'
          : 'latestVersion'
        ]
      let formatted = formatVersion(
        targetVersion,
        currentComputedByIndex[index]?.effectiveForDiff ??
          update.currentVersion,
      )
      maxVersionLength = Math.max(maxVersionLength, stripAnsi(formatted).length)
    }
    let versionFromComment = currentComputedByIndex[index]?.versionForPadding
    if (versionFromComment) {
      maxVersionLength = Math.max(
        maxVersionLength,
        stripAnsi(versionFromComment).length,
      )
    }
    if (update.publishedAt) {
      hasAnyAge = true
    }
  }

  let globalActionWidth = Math.max(maxActionLength, MIN_ACTION_WIDTH)
  let globalCurrentWidth = Math.max(maxCurrentLength, MIN_CURRENT_WIDTH)
  let globalJobWidth = Math.max(maxJobLength, MIN_JOB_WIDTH)
  let globalVersionWidth = Math.min(maxVersionLength, MAX_VERSION_WIDTH)
  let globalTargetWidth = globalVersionWidth + 1 + 9
  let globalAgeWidth = showAge && hasAnyAge ? 6 : 0

  for (let [fileIndex, file] of sortedFiles.entries()) {
    let fileGroup = groups.get(file)
    if (!fileGroup) {
      console.warn(`Unexpected missing group for file: ${file}`)
      continue
    }

    let tableRows: TableRow[] = []

    let groupOrder = fileGroup

    tableRows.push({
      current: 'Current',
      action: 'Action',
      target: 'Target',
      arrow: '❯',
      job: 'Job',
      age: 'Age',
    })

    for (let { update, index } of groupOrder) {
      let hasTarget = hasResolvedTarget(update)

      let currentComputed = currentComputedByIndex[index]!
      let current = currentComputed.display
      if (currentComputed.versionForPadding && currentComputed.shortSha) {
        current = `${padString(currentComputed.versionForPadding, globalVersionWidth + 1)}${colors.gray(`(${currentComputed.shortSha})`)}`
      }
      let effectiveCurrentForDiff =
        currentComputed.effectiveForDiff ?? update.currentVersion
      let latest = formatVersion(
        getTargetVersion(update),
        effectiveCurrentForDiff,
      )
      let actionName = update.action.name

      if (
        getResolvedTargetStyle(update) === 'sha' &&
        getResolvedTarget(update)
      ) {
        let shortSha = getResolvedTarget(update)!.slice(0, 7)
        latest = `${padString(latest, globalVersionWidth + 1)}${colors.gray(`(${shortSha})`)}`
      }

      if (!hasTarget) {
        latest = colors.gray(latest)
        current = colors.gray(current)
        actionName = colors.gray(actionName)
      }

      let jobName = update.action.job ?? '–'
      let age = formatAge(update.publishedAt)
      tableRows.push({
        job: hasTarget ? jobName : colors.gray(jobName),
        age: hasTarget ? age : colors.gray(age),
        action: actionName,
        target: latest,
        arrow: '❯',
        current,
      })
    }

    let maxActionWidth = Math.max(globalActionWidth, MIN_ACTION_WIDTH)
    let maxCurrentWidth = Math.max(globalCurrentWidth, MIN_CURRENT_WIDTH)
    let maxJobWidth = Math.max(globalJobWidth, MIN_JOB_WIDTH)

    entries.push({ message: colors.gray(file), kind: 'group' })
    for (let [i, row] of tableRows.entries()) {
      let formattedRow = formatTableRow({
        targetWidth: globalTargetWidth,
        currentWidth: maxCurrentWidth,
        actionWidth: maxActionWidth,
        ageWidth: globalAgeWidth,
        jobWidth: maxJobWidth,
        row,
      })
      if (i === 0) {
        entries.push({
          message: colors.gray(` ○ ${formattedRow}`),
          kind: 'separator',
        })
        continue
      }
      let { update, index } = groupOrder[i - 1]!
      let hasTarget = hasResolvedTarget(update)
      entries.push({
        selected: hasTarget && !update.isBreaking,
        message: formattedRow,
        disabled: !hasTarget,
        kind: 'option',
        value: index,
      })
    }

    /**
     * Add a blank separator line between groups for readability.
     */
    if (fileIndex < sortedFiles.length - 1) {
      entries.push({ kind: 'separator', message: ' ' })
    }
  }

  try {
    let selected = await runMultiselect({
      message:
        'Choose which actions to update ' +
        `(Press ${colors.cyan('<space>')} to select, ` +
        `${colors.cyan('<a>')} to toggle all, ` +
        `${colors.cyan('<i>')} to invert selection)`,
      summarize: indexes =>
        indexes.length > 0 ? formatSelectionSummary(indexes.length) : '',
      footer: 'Enter to start updating. Ctrl-c to cancel.',
      entries,
    })

    if (!selected) {
      logSelectionCancelled()
      return null
    }

    let result = outdated.filter((_, index) => selected.includes(index))

    if (result.length === 0) {
      console.info(colors.yellow('\nNo actions selected'))
      return null
    }

    return result
  } catch (error) {
    console.error(colors.red('Unexpected error during selection:'), error)
    throw error
  }
}

/**
 * Format age of a release in human-readable format.
 *
 * @param publishedAt - Publication date.
 * @returns Formatted age string (e.g., "2h", "3d", "1w 3d").
 */
function formatAge(publishedAt: Date | null): string {
  if (!publishedAt) {
    return ''
  }

  let now = Date.now()
  let ageMs = now - publishedAt.getTime()
  let hours = Math.floor(ageMs / (1000 * 60 * 60))
  let days = Math.floor(hours / 24)
  let weeks = Math.floor(days / 7)
  let remainingDays = days % 7

  if (weeks >= 1) {
    if (remainingDays > 0) {
      return `${weeks}w ${remainingDays}d`
    }
    return `${weeks}w`
  }
  if (days >= 1) {
    return `${days}d`
  }
  return `${hours}h`
}

/**
 * Format a table row with proper spacing.
 *
 * @param options - Formatting options.
 * @returns Formatted row string.
 */
function formatTableRow(options: FormatTableRowOptions): string {
  let { currentWidth, actionWidth, targetWidth, jobWidth, ageWidth, row } =
    options
  let parts = [
    padString(row.action, actionWidth),
    padString(row.job, jobWidth),
    padString(row.current, currentWidth),
    row.arrow,
    padString(row.target, targetWidth),
  ]

  if (ageWidth > 0) {
    parts.push(row.age)
  }

  let line = parts.join('  ')
  return line.replace(/\s+$/u, '')
}

/**
 * Format version or SHA for display, shortening long SHAs.
 *
 * @param version - Version or SHA string.
 * @returns Formatted string.
 */
function formatVersionOrSha(version: undefined | string | null): string {
  if (!version) {
    return colors.gray('unknown')
  }

  if (isSha(version)) {
    return version.slice(0, 7)
  }

  return version.replace(/^v/u, '')
}

function getTargetVersion(update: ActionUpdate): string | null {
  if (getResolvedTargetStyle(update) === 'tag' && getResolvedTarget(update)) {
    return getResolvedTarget(update)
  }

  return update.latestVersion
}

function getResolvedTargetStyle(
  update: ActionUpdate,
): ActionUpdate['targetRefStyle'] {
  if (update.targetRefStyle) {
    return update.targetRefStyle
  }

  return update.latestSha ? 'sha' : null
}

function formatSelectionSummary(selectedCount: number): string {
  let noun = selectedCount === 1 ? 'action' : 'actions'
  return `${selectedCount} ${noun} selected`
}

function getResolvedTarget(update: ActionUpdate): string | null {
  if (update.targetRef) {
    return update.targetRef
  }

  return update.latestSha
}

/**
 * Logs a cancellation message to the console, clearing any terminal artifacts
 * left by the interactive prompt.
 *
 * Uses `\r` to return the cursor to the beginning of the line and `\x1b[K`
 * (ANSI escape code) to clear from the cursor to the end of the line. This
 * prevents leftover text from the prompt being concatenated with the
 * cancellation message.
 */
function logSelectionCancelled(): void {
  console.info(`\r\u{1B}[K${colors.yellow('Selection cancelled')}`)
}

function hasResolvedTarget(update: ActionUpdate): boolean {
  return Boolean(getResolvedTarget(update))
}
