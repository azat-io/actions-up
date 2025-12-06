import type Enquirer from 'enquirer'

import { readFile } from 'node:fs/promises'
import enquirer from 'enquirer'
import 'node:worker_threads'
import path from 'node:path'
import pc from 'picocolors'

import type { ActionUpdate } from '../../types/action-update'

import { formatVersion } from './format-version'
import { GITHUB_DIRECTORY } from '../constants'
import { stripAnsi } from './strip-ansi'
import { padString } from './pad-string'

/** Global minimum widths for the action and current version columns. */
const MIN_ACTION_WIDTH = 40

/** Global minimum width for the job column. */
const MIN_JOB_WIDTH = 4

/** Global minimum width for the current version column. */
const MIN_CURRENT_WIDTH = 16

/** Maximum width for version padding before SHA hash. */
const MAX_VERSION_WIDTH = 7

/** Minimal prompt options shape we use to avoid Enquirer union pitfalls. */
interface PromptOptionsLike {
  /** Renders selection marker for a choice. */
  indicator(
    state: unknown,
    choice: (ChoiceSeparator | ChoiceItem) & { enabled?: boolean },
  ): string

  /** Choices list: our items and separators. */
  choices: (ChoiceSeparator | ChoiceItem | string)[]

  /** Alias to `down()` bound by enquirer. */
  j(): Promise<string[]> | undefined

  /** Alias to `up()` bound by enquirer. */
  k(): Promise<string[]> | undefined

  /** Style hooks from enquirer (we pass-through). */
  styles?: Record<string, unknown>

  /** Moves focus down (provided by enquirer at runtime). */
  down?(): Promise<string[]>

  /** Moves focus up (provided by enquirer at runtime). */
  up?(): Promise<string[]>

  /** Prompt type. We only use multiselect. */
  type: 'multiselect'

  /** Pointer glyph for focused row. */
  pointer?: string

  /** The question text shown above the list. */
  message: string

  /** Footer text under the list. */
  footer?: string

  /** Alias to `cancel()` bound by enquirer. */
  cancel(): null

  /** The name of the answer field returned by enquirer (holds selected). */
  name: string
}

/** Selectable item displayed in the multiselect list. */
interface ChoiceItem {
  /**
   * Optional nested choices (used for group labels to hold their rows).
   * Enquirer supports passing nested structures for group toggling.
   */
  choices?: (ChoiceSeparator | ChoiceItem)[]

  /** Whether this item is a focusable group label (file row). */
  isGroupLabel?: boolean

  /** Whether this item is disabled and cannot be toggled. */
  disabled?: boolean

  /** Whether this item is currently selected/enabled. */
  enabled?: boolean

  /** Visible text rendered for this choice. */
  message: string

  /** Optional hint rendered by enquirer when disabled. */
  hint?: string

  /** Internal value returned by the prompt when selected. */
  value: string

  /** Stable name used by enquirer to track the choice. */
  name: string
}

/** Intermediate representation for a row in the table before formatting. */
interface TableRow {
  /** Current version rendered in the third column. */
  current: string

  /** Action name rendered in the first column. */
  action: string

  /** Target version rendered in the last column. */
  target: string

  /** Arrow glyph placed between versions. */
  arrow: string

  /** Job name rendered in the second column. */
  job: string

  /** Age of the release (e.g., "2d", "3w"). */
  age: string
}

interface FormatTableRowOptions {
  /** Width for current version column. */
  currentWidth: number

  /** Width for action column. */
  actionWidth: number

  /** Width for target column. */
  targetWidth: number

  /** Width for job column. */
  jobWidth: number

  /** Width for age column (0 to hide). */
  ageWidth: number

  /** Row data to format. */
  row: TableRow
}

/** Non-selectable visual row (e.g., table header or blank line). */
interface ChoiceSeparator {
  /** Enquirer role that marks this element as non-selectable. */
  role: 'separator'

  /** Visible text for the separator line. */
  message: string

  /** Optional name to satisfy enquirer's `Choice` typing. */
  name?: string
}

/** Result shape returned by enquirer for the multiselect prompt. */
interface PromptResult {
  /** Selected values (indexes or label keys) as strings. */
  selected: string[]
}

interface PromptUpdateSelectionOptions {
  /** Whether to show the Age column. */
  showAge?: boolean
}

type PromptOptions = Extract<
  Parameters<Enquirer['prompt']>[0],
  Record<string, unknown>
>

export async function promptUpdateSelection(
  updates: ActionUpdate[],
  options: PromptUpdateSelectionOptions = {},
): Promise<ActionUpdate[] | null> {
  let { showAge = false } = options

  if (updates.length === 0) {
    return null
  }

  /**
   * Only outdated (hasUpdate). Items without latestSha are shown but disabled —
   * always pinning.
   */
  let outdated = updates.filter(update => update.hasUpdate)

  if (outdated.length === 0) {
    console.info(pc.green('✓ All actions are up to date!'))
    return null
  }

  /** Group by files for user convenience. */
  let groups = new Map<string, { update: ActionUpdate; index: number }[]>()

  for (let [index, update] of outdated.entries()) {
    let originalFile = update.action.file ?? 'unknown file'
    /** Show relative path without .github directory. */
    let file = path.relative(
      path.join(process.cwd(), GITHUB_DIRECTORY),
      originalFile,
    )

    if (file === '') {
      file = originalFile
    }

    let group = groups.get(file) ?? []

    group.push({ update, index })
    groups.set(file, group)
  }

  /**
   * Resolve display value for Current and an effective version for diffing. If
   * the current ref is a SHA and we previously pinned with a version comment
   * (e.g. "# v5.0.0"), show that version instead of the SHA and use it for diff
   * coloring in the Target column.
   */
  let currentComputedByIndex = await Promise.all(
    outdated.map(async update => {
      let display = formatVersionOrSha(update.currentVersion)
      let effectiveForDiff: undefined | string =
        update.currentVersion ?? undefined
      let versionForPadding: string | null = null
      let shortSha: string | null = null

      if (!update.currentVersion || !isSha(update.currentVersion)) {
        return { versionForPadding, effectiveForDiff, shortSha, display }
      }

      let versionFromComment = await tryReadInlineVersionComment(
        update.action.file,
        update.action.line,
      )

      if (versionFromComment) {
        shortSha = update.currentVersion.slice(0, 7)
        versionForPadding = formatVersionOrSha(versionFromComment)
        display = versionForPadding
        effectiveForDiff = versionFromComment
      }

      return { versionForPadding, effectiveForDiff, shortSha, display }
    }),
  )

  let choices: (ChoiceSeparator | ChoiceItem)[] = []

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
      currentComputed.versionForPadding && currentComputed.shortSha
        ? stripAnsi(
            `${padString(
              currentComputed.versionForPadding,
              maxVersionLength + 1,
            )}${pc.gray(`(${currentComputed.shortSha})`)}`,
          ).length
        : 0,
    )
    maxJobLength = Math.max(maxJobLength, jobRaw.length)
    if (update.latestVersion) {
      let formatted = formatVersion(
        update.latestVersion,
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

  let sortedFiles = [...groups.keys()].toSorted()

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
      let hasSha = Boolean(update.latestSha)

      let currentComputed = currentComputedByIndex[index]!
      let current = currentComputed.display
      if (currentComputed.versionForPadding && currentComputed.shortSha) {
        current = `${padString(currentComputed.versionForPadding, globalVersionWidth + 1)}${pc.gray(`(${currentComputed.shortSha})`)}`
      }
      let effectiveCurrentForDiff =
        currentComputed.effectiveForDiff ?? update.currentVersion
      let latest = formatVersion(update.latestVersion, effectiveCurrentForDiff)
      let actionName = update.action.name

      if (update.latestSha) {
        let shortSha = update.latestSha.slice(0, 7)
        latest = `${padString(latest, globalVersionWidth + 1)}${pc.gray(`(${shortSha})`)}`
      }

      if (!hasSha) {
        latest = pc.gray(latest)
        current = pc.gray(current)
        actionName = pc.gray(actionName)
      }

      let jobName = update.action.job ?? '–'
      let age = formatAge(update.publishedAt)
      tableRows.push({
        job: hasSha ? jobName : pc.gray(jobName),
        age: hasSha ? age : pc.gray(age),
        action: actionName,
        target: latest,
        arrow: '❯',
        current,
      })
    }

    let maxActionWidth = Math.max(globalActionWidth, MIN_ACTION_WIDTH)
    let maxCurrentWidth = Math.max(globalCurrentWidth, MIN_CURRENT_WIDTH)
    let maxJobWidth = Math.max(globalJobWidth, MIN_JOB_WIDTH)

    let groupChildren: (ChoiceSeparator | ChoiceItem)[] = []
    for (let [i, row] of tableRows.entries()) {
      let isHeader = i === 0
      let formattedRow = formatTableRow({
        targetWidth: globalTargetWidth,
        currentWidth: maxCurrentWidth,
        actionWidth: maxActionWidth,
        ageWidth: globalAgeWidth,
        jobWidth: maxJobWidth,
        row,
      })
      if (isHeader) {
        groupChildren.push({
          message: pc.gray(` ○ ${formattedRow}`),
          role: 'separator',
          // Remove auto-child indent to tighten left padding
          // @ts-expect-error enquirer supports indent on choice-like objects
          indent: '',
          name: '',
        })
      } else {
        let { update, index } = groupOrder[i - 1]!
        let hasSha = Boolean(update.latestSha)
        let enabled = hasSha && !update.isBreaking
        groupChildren.push({
          message: formattedRow,
          value: String(index),
          name: String(index),
          disabled: !hasSha,
          // Remove auto-child indent to tighten left padding
          // @ts-expect-error enquirer supports indent on choice items
          indent: '',
          enabled,
        })
      }
    }

    /** Push focusable group label with nested children. */
    choices.push({
      message: pc.gray(file),
      value: `label|${file}`,
      choices: groupChildren,
      name: `label|${file}`,
      isGroupLabel: true,
      enabled: false,
    } as unknown as ChoiceItem)

    /** Add a blank separator line between groups for readability. */
    if (fileIndex < sortedFiles.length - 1) {
      choices.push({ role: 'separator', message: ' ', name: '' })
    }
  }

  try {
    let promptOptions: PromptOptionsLike = {
      indicator(
        _state: unknown,
        choice: {
          choices?: (ChoiceSeparator | ChoiceItem)[]
          isGroupLabel?: boolean
        } & {
          enabled?: boolean
        },
      ) {
        let isLabel = Boolean(choice.isGroupLabel)

        if (isLabel) {
          let allChildren = choice.choices ?? []
          let rows = allChildren.filter(
            (child): child is ChoiceItem => !('role' in child),
          )
          let total = rows.length
          let selectedCount = rows.filter(row => Boolean(row.enabled)).length
          let mark = selectedCount === total ? '●' : '○'

          return ` ${pc.gray(mark)}`
        }

        return `   ${choice.enabled ? '●' : '○'}`
      },
      message:
        'Choose which actions to update ' +
        `(Press ${pc.cyan('<space>')} to select, ` +
        `${pc.cyan('<a>')} to toggle all, ` +
        `${pc.cyan('<i>')} to invert selection)`,
      styles: {
        success: pc.reset,
        em: pc.bgBlack,
        dark: pc.reset,
      },
      cancel() {
        logSelectionCancelled()
        return null
      },
      j() {
        return this.down?.() ?? Promise.resolve([])
      },
      k() {
        return this.up?.() ?? Promise.resolve([])
      },
      footer: '\nEnter to start updating. Ctrl-c to cancel.',
      type: 'multiselect',
      name: 'selected',
      pointer: '❯',
      choices,
    }

    let { selected } = await enquirer.prompt<PromptResult>(
      promptOptions as unknown as PromptOptions,
    )

    let selectedIndexes = new Set<number>()

    for (let valueString of selected) {
      if (valueString.startsWith('label|')) {
        let fileKey = valueString.slice('label|'.length)
        let groupItems = groups.get(fileKey) ?? []

        for (let { update: upd, index } of groupItems) {
          if (upd.latestSha) {
            selectedIndexes.add(index)
          }
        }
        continue
      }
      let index = Number.parseInt(valueString, 10)
      if (Number.isFinite(index)) {
        selectedIndexes.add(index)
      }
    }

    let result: ActionUpdate[] = []
    for (let [index, outdatedUpdate] of outdated.entries()) {
      if (selectedIndexes.has(index) && outdatedUpdate.latestSha) {
        result.push(outdatedUpdate)
      }
    }

    if (result.length === 0) {
      console.info(pc.yellow('\nNo actions selected'))
      return null
    }

    return result
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('cancelled') ||
        error.message.includes('ESC') ||
        error.name === 'ExitPromptError')
    ) {
      logSelectionCancelled()
      return null
    }

    console.error(pc.red('Unexpected error during selection:'), error)
    throw error
  }
}

/**
 * Best-effort extraction of version number from an inline comment on the same
 * line as `uses:`. Expected shape after update is, for example: `uses:
 * actions/checkout@<sha> # v5.0.0`.
 *
 * Only used when the current reference is a SHA. Returns null if not found.
 *
 * @param filePath - Absolute path to the YAML file.
 * @param lineNumber - 1-based line number of the `uses:` key.
 * @returns Extracted version (e.g., `v5.0.0`) or null when not present.
 */
async function tryReadInlineVersionComment(
  filePath: undefined | string,
  lineNumber: undefined | number,
): Promise<string | null> {
  try {
    if (!filePath || !lineNumber || lineNumber <= 0) {
      return null
    }

    let content = await readFile(filePath, 'utf8')
    let lines = content.split('\n')
    let index = lineNumber - 1
    if (index < 0 || index >= lines.length) {
      return null
    }

    let line = lines[index]!
    let match = line.match(
      /#\s*(?<version>[Vv]?\d+(?:\.\d+){0,2}(?:[+-][\w\-.]+)?)/u,
    )
    if (match?.groups?.['version']) {
      return match.groups['version']
    }
  } catch {
    /** Ignore errors - simply fall back to SHA display. */
  }
  return null
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
 * Check if a string is a Git SHA hash.
 *
 * @param value - String to check.
 * @returns True if the string is a SHA hash.
 */
function isSha(value: string): boolean {
  /** Remove 'v' prefix if present. */
  let normalized = value.replace(/^v/u, '')

  /** Check if it matches SHA pattern (7-40 hex characters). */
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}

/**
 * Format version or SHA for display, shortening long SHAs.
 *
 * @param version - Version or SHA string.
 * @returns Formatted string.
 */
function formatVersionOrSha(version: undefined | string | null): string {
  if (!version) {
    return pc.gray('unknown')
  }

  if (isSha(version)) {
    return version.slice(0, 7)
  }

  return version.replace(/^v/u, '')
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
  console.info(`\r\u001B[K${pc.yellow('Selection cancelled')}`)
}
