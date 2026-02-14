import { relative, resolve } from 'node:path'
import { createSpinner } from 'nanospinner'
import 'node:worker_threads'
import pc from 'picocolors'
import cac from 'cac'

import type { ScanResult } from '../types/scan-result'
import type { UpdateMode } from '../types/update-mode'

import { readInlineVersionComment } from '../core/versions/read-inline-version-comment'
import { promptUpdateSelection } from '../core/interactive/prompt-update-selection'
import { getCompatibleUpdate } from '../core/api/get-compatible-update'
import { createGitHubClient } from '../core/api/create-github-client'
import { getUpdateLevel } from '../core/versions/get-update-level'
import { applyUpdates } from '../core/ast/update/apply-updates'
import { shouldIgnore } from '../core/ignore/should-ignore'
import { checkUpdates } from '../core/api/check-updates'
import { scanRecursive } from '../core/scan-recursive'
import { GITHUB_DIRECTORY } from '../core/constants'
import { scanGitHubActions } from '../core/index'
import { isSha } from '../core/versions/is-sha'
import { version } from '../package.json'

/** CLI Options. */
interface CLIOptions {
  /** Regex patterns to exclude actions by name (repeatable). */
  exclude?: string[] | string

  /** Whether to include branch references in update checks. */
  includeBranches?: boolean

  /** Custom directory name (e.g., '.gitea' instead of '.github'). */
  dir?: string[] | string

  /** Recursively scan directories for YAML files. */
  recursive?: boolean

  /** Update mode (major, minor, patch). */
  mode?: UpdateMode

  /** Preview changes without applying them. */
  dryRun: boolean

  /** Minimum age in days for updates. */
  minAge: number

  /** Skip all confirmations. */
  yes: boolean
}

/** Run the CLI. */
export function run(): void {
  let cli = cac('actions-up')

  cli
    .help()
    .version(version)
    .option('--dir <directory>', 'Custom directory name (default: .github)')
    .option('--dry-run', 'Preview changes without applying them')
    .option('--exclude <regex>', 'Exclude actions by regex (repeatable)')
    .option(
      '--include-branches',
      'Also check actions pinned to branches (default: false)',
    )
    .option(
      '--min-age <days>',
      'Minimum age in days for updates (default: 0)',
      {
        default: 0,
      },
    )
    .option(
      '--mode <mode>',
      'Update mode: major, minor, or patch (default: major)',
      {
        default: 'major',
      },
    )
    .option('--recursive, -r', 'Recursively scan directories for YAML files')
    .option('--yes, -y', 'Skip all confirmations')
    .command('', 'Update GitHub Actions')
    .action(async (options: CLIOptions) => {
      console.info(pc.cyan('\n🚀 Actions Up!\n'))

      let spinner = createSpinner('Scanning GitHub Actions...').start()

      let rawDirectories: string[] = []
      if (Array.isArray(options.dir)) {
        rawDirectories.push(...options.dir)
      } else if (typeof options.dir === 'string') {
        rawDirectories.push(options.dir)
      } else {
        rawDirectories.push(GITHUB_DIRECTORY)
      }

      let directories = [
        ...new Set(
          rawDirectories.map(value => {
            let cwd = process.cwd()
            return relative(cwd, resolve(cwd, value)) || '.'
          }),
        ),
      ]

      try {
        /** Scan for GitHub Actions in the repository. */
        let scanResults = options.recursive
          ? await Promise.all(
              directories.map(directory =>
                scanRecursive(process.cwd(), directory),
              ),
            )
          : await Promise.all(
              directories.map(directory =>
                scanGitHubActions(process.cwd(), directory),
              ),
            )
        let scanResult = mergeScanResults(scanResults)

        let totalActions = scanResult.actions.length
        let totalWorkflows = scanResult.workflows.size
        let totalCompositeActions = scanResult.compositeActions.size

        spinner.success(
          `Found ${pc.yellow(totalActions)} actions in ` +
            `${pc.yellow(totalWorkflows)} workflows and ` +
            `${pc.yellow(totalCompositeActions)} composite actions`,
        )

        if (totalActions === 0) {
          console.info(
            pc.green('\n✨ No GitHub Actions found in this repository'),
          )
          return
        }

        /** Prepare actions list and apply CLI excludes if provided. */
        let actionsToCheck = scanResult.actions

        let rawExcludes: string[] = []
        if (Array.isArray(options.exclude)) {
          rawExcludes.push(...options.exclude)
        } else if (typeof options.exclude === 'string') {
          rawExcludes.push(options.exclude)
        }

        /** Support comma-separated lists inside a single flag. */
        let normalizedExcludes = rawExcludes
          .flatMap(item => item.split(','))
          .map(item => item.trim())
          .filter(Boolean)

        if (normalizedExcludes.length > 0) {
          let { parseExcludePatterns } =
            await import('../core/filters/parse-exclude-patterns')
          let regexes = parseExcludePatterns(normalizedExcludes)
          if (regexes.length > 0) {
            actionsToCheck = actionsToCheck.filter(action => {
              let { name } = action
              for (let rx of regexes) {
                if (rx.test(name)) {
                  return false
                }
              }
              return true
            })
          }
        }

        /** Check for updates. */
        spinner = createSpinner('Checking for updates...').start()

        if (actionsToCheck.length === 0) {
          spinner.success('No actions to check after excludes')
          console.info(pc.green('\n✨ Nothing to check after excludes\n'))
          return
        }

        let token = process.env['GITHUB_TOKEN']
        let githubClient = createGitHubClient(token)
        let includeBranches = options.includeBranches ?? false

        let updates = await checkUpdates(actionsToCheck, token, {
          client: githubClient,
          includeBranches,
        })

        /** Apply ignore comments (file/block/next-line/inline). */
        let filtered: typeof updates = []
        await Promise.all(
          updates.map(async update => {
            let ignored = await shouldIgnore(
              update.action.file,
              update.action.line,
            )
            if (!ignored) {
              filtered.push(update)
            }
          }),
        )

        /** Skipped entries that should trigger a warning (e.g., branches). */
        let skipped = filtered.filter(update => update.status === 'skipped')

        /** Filter outdated actions. */
        let outdated = filtered.filter(update => update.hasUpdate)

        /** Filter by minimum age if publishedAt is available. */
        let minAgeMs = options.minAge * 24 * 60 * 60 * 1000
        let now = Date.now()
        outdated = outdated.filter(update => {
          if (!update.publishedAt) {
            return true
          }
          let age = now - update.publishedAt.getTime()
          return age >= minAgeMs
        })

        let mode = normalizeUpdateMode(options.mode)
        let blockedByMode: typeof outdated = []
        if (mode !== 'major') {
          let tagsCache = new Map<
            string,
            Awaited<ReturnType<typeof githubClient.getAllTags>>
          >()
          let shaCache = new Map<string, string | null>()
          let fileCache = new Map<string, string>()
          let decisions = await Promise.all(
            outdated.map(async update => {
              let effectiveCurrentVersion = update.currentVersion
              if (isSha(update.currentVersion)) {
                let inline = await readInlineVersionComment(
                  update.action.file,
                  update.action.line,
                  fileCache,
                )
                if (inline) {
                  effectiveCurrentVersion = inline
                }
              }

              let level = getUpdateLevel(
                effectiveCurrentVersion,
                update.latestVersion,
              )
              let allowed =
                mode === 'minor'
                  ? level === 'minor' || level === 'patch' || level === 'none'
                  : level === 'patch' || level === 'none'

              return { effectiveCurrentVersion, allowed, update }
            }),
          )

          let allowedByMode: typeof outdated = []
          let compatibleFallbacks = await Promise.all(
            decisions.map(async decision => {
              if (decision.allowed) {
                return { update: decision.update }
              }

              let compatible = await getCompatibleUpdate(githubClient, {
                currentVersion: decision.effectiveCurrentVersion,
                actionName: decision.update.action.name,
                tagsCache,
                shaCache,
                mode,
              })

              if (!compatible) {
                return { blocked: decision.update }
              }

              return {
                update: {
                  ...decision.update,
                  latestVersion: compatible.version,
                  latestSha: compatible.sha,
                  isBreaking: false,
                  hasUpdate: true,
                },
              }
            }),
          )

          for (let decision of compatibleFallbacks) {
            if (decision.update) {
              allowedByMode.push(decision.update)
              continue
            }

            blockedByMode.push(decision.blocked)
          }

          outdated = allowedByMode
        }

        let breaking = outdated.filter(update => update.isBreaking)

        if (outdated.length === 0) {
          spinner.success('All actions are up to date!')
          if (skipped.length > 0) {
            printSkippedWarning(skipped, includeBranches)
          }
          if (blockedByMode.length > 0) {
            printModeWarning(blockedByMode, mode)
          }
          console.info(
            pc.green('\n✨ Everything is already at the latest version!\n'),
          )
          return
        }

        spinner.success(
          `Found ${pc.yellow(outdated.length)} updates available${
            breaking.length > 0
              ? ` (${pc.redBright(breaking.length)} breaking)`
              : ''
          }`,
        )

        if (skipped.length > 0) {
          printSkippedWarning(skipped, includeBranches)
        }
        if (blockedByMode.length > 0) {
          printModeWarning(blockedByMode, mode)
        }

        if (options.dryRun) {
          console.info(pc.yellow('\n📋 Dry Run - No changes will be made\n'))

          for (let update of outdated) {
            console.info(
              `${pc.cyan(update.action.file ?? 'unknown')}:\n` +
                `${update.action.name}: ${pc.redBright(update.currentVersion)} → ${pc.green(
                  update.latestVersion,
                )} ${update.latestSha ? pc.gray(`(${update.latestSha.slice(0, 7)})`) : ''}\n`,
            )
          }

          console.info(
            pc.gray(`\n${outdated.length} actions would be updated\n`),
          )
          return
        }

        if (options.yes) {
          /** Auto-update all actions with SHA. */
          let toUpdate = outdated.filter(update => update.latestSha)
          if (toUpdate.length === 0) {
            console.info(
              pc.yellow('\n⚠️ No actions with SHA available for update\n'),
            )
            return
          }

          console.info(
            pc.yellow(`\n🔄 Updating ${toUpdate.length} actions...\n`),
          )

          await applyUpdates(toUpdate)

          console.info(pc.green('\n✓ Updates applied successfully!'))
        } else {
          if (skipped.length > 0 || blockedByMode.length > 0) {
            console.info('')
          }

          let selected = await promptUpdateSelection(outdated, {
            showAge: options.minAge > 0,
          })

          if (!selected || selected.length === 0) {
            console.info(pc.gray('\nNo updates applied'))
            return
          }

          console.info(
            pc.yellow(`\n🔄 Updating ${selected.length} selected actions...\n`),
          )

          await applyUpdates(selected)

          console.info(pc.green('\n✓ Updates applied successfully!'))
        }
      } catch (error) {
        spinner.error('Failed')

        /** Handle rate limit errors with helpful message. */
        if (error instanceof Error && error.name === 'GitHubRateLimitError') {
          console.error(pc.yellow('\n⚠️ Rate Limit Exceeded\n'))
          console.error(error.message)
          console.error(
            pc.gray('\nExample: GITHUB_TOKEN=ghp_xxxx actions-up\n'),
          )
        } else {
          console.error(
            pc.redBright('\nError:'),
            error instanceof Error ? error.message : String(error),
          )
        }
        process.exit(1)
      }
    })

  cli.parse()
}

/**
 * Merge multiple scan results into one.
 *
 * @param results - Array of scan results.
 * @returns Merged scan result.
 */
function mergeScanResults(results: ScanResult[]): ScanResult {
  let merged: ScanResult = {
    compositeActions: new Map(),
    workflows: new Map(),
    actions: [],
  }
  for (let result of results) {
    for (let [key, value] of result.workflows) {
      merged.workflows.set(key, value)
    }
    for (let [, value] of result.compositeActions) {
      merged.compositeActions.set(value, value)
    }
    merged.actions.push(...result.actions)
  }

  /** Deduplicate actions that appear in multiple scan results. */
  let seen = new Set<string>()
  merged.actions = merged.actions.filter(action => {
    let key = `${action.file}:${action.line}:${action.name}:${action.version}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })

  return merged
}

/**
 * Render a warning block listing actions skipped due to update mode.
 *
 * @param blocked - Actions blocked by mode.
 * @param mode - Selected update mode.
 */
function printModeWarning(
  blocked: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
  mode: UpdateMode,
): void {
  if (blocked.length === 0) {
    return
  }

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let form = pluralRules.select(blocked.length)
  let noun = form === 'one' ? 'action' : 'actions'
  let label = mode === 'minor' ? 'major' : 'major/minor'

  console.info(
    pc.yellow(
      `\n⚠️  Skipped ${blocked.length} ${noun} due to ${label} updates`,
    ),
  )
  for (let update of blocked) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    console.info(pc.gray(`   • ${identifier}`))
  }
}

/**
 * Render a warning block listing actions skipped due to branch references.
 *
 * @param skipped - Actions that were skipped.
 * @param includeBranches - Whether branch refs were opted-in for checking.
 */
function printSkippedWarning(
  skipped: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
  includeBranches: boolean,
): void {
  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let form = pluralRules.select(skipped.length)
  let noun = form === 'one' ? 'action' : 'actions'

  let hint = includeBranches ? '' : ' (use --include-branches to check them)'
  console.info(
    pc.yellow(
      `\n⚠️  Skipped ${skipped.length} ${noun} pinned to branches${hint}`,
    ),
  )
  for (let update of skipped) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    console.info(pc.gray(`   • ${identifier}`))
  }
}

/**
 * Normalize and validate update mode option.
 *
 * @param mode - Raw mode option.
 * @returns Normalized update mode.
 */
function normalizeUpdateMode(mode: undefined | string): UpdateMode {
  let normalized = (mode ?? 'major').toLowerCase()
  if (
    normalized === 'major' ||
    normalized === 'minor' ||
    normalized === 'patch'
  ) {
    return normalized
  }
  throw new Error(
    `Invalid mode "${mode}". Expected "major", "minor", or "patch".`,
  )
}
