import { createSpinner } from 'nanospinner'
import { resolve } from 'node:path'
import 'node:worker_threads'
import pc from 'picocolors'

import type { JsonReportStatus } from './build-json-report'
import type { ActionUpdate } from '../types/action-update'
import type { ScanResult } from '../types/scan-result'
import type { CLIOptions } from './parse-arguments'

import { promptUpdateSelection } from '../core/interactive/prompt-update-selection'
import { resolveTargetReference } from '../core/updates/resolve-target-reference'
import { parseVersionComment } from '../core/versions/parse-version-comment'
import { getCompatibleUpdate } from '../core/api/get-compatible-update'
import { createGitHubClient } from '../core/api/create-github-client'
import { filterDowngradeUpdates } from './filter-downgrade-updates'
import { resolveScanDirectories } from './resolve-scan-directories'
import { getUpdateLevel } from '../core/versions/get-update-level'
import { printRateLimitWarning } from './print-rate-limit-warning'
import { printDowngradeWarning } from './print-downgrade-warning'
import { anchorDirectoryInputs } from './anchor-directory-inputs'
import { applyUpdates } from '../core/ast/update/apply-updates'
import { normalizeUpdateStyle } from './normalize-update-style'
import { printSkippedWarning } from './print-skipped-warning'
import { normalizeUpdateMode } from './normalize-update-mode'
import { printMinAgeWarning } from './print-min-age-warning'
import { validateCliOptions } from './validate-cli-options'
import { shouldIgnore } from '../core/ignore/should-ignore'
import { findRepoRoot } from '../core/fs/find-repo-root'
import { checkUpdates } from '../core/api/check-updates'
import { mergeScanResults } from './merge-scan-results'
import { printModeWarning } from './print-mode-warning'
import { scanRecursive } from '../core/scan-recursive'
import { buildJsonReport } from './build-json-report'
import { parseArguments } from './parse-arguments'
import { scanGitHubActions } from '../core/index'
import { isSha } from '../core/versions/is-sha'
import { version } from '../package.json'

/**
 * Payload used by the local JSON writer helper in the CLI.
 */
interface WriteJsonReportOptions {
  /**
   * Updates excluded by the selected update mode.
   */
  blockedByMode?: ActionUpdate[]

  /**
   * Number of actions checked after excludes.
   */
  actionsToCheckCount: number

  /**
   * Actionable updates to serialize.
   */
  outdated?: ActionUpdate[]

  /**
   * Skipped updates to serialize.
   */
  skipped?: ActionUpdate[]

  /**
   * Overall JSON report status.
   */
  status: JsonReportStatus

  /**
   * Aggregate scan result for the current run.
   */
  scanResult: ScanResult
}

/**
 * Run the CLI.
 */
export function run(): void {
  let parsed = parseArguments(process.argv.slice(2), version)

  if (parsed.kind === 'help' || parsed.kind === 'version') {
    console.info(parsed.text)
    return
  }

  if (parsed.kind === 'error') {
    console.error(pc.redBright('\nError:'), parsed.message)
    process.exit(1)
  }

  void runUpdate(parsed.options)
}

/**
 * Run the update pipeline for the parsed CLI options.
 *
 * @param options - Parsed and normalized CLI options.
 */
async function runUpdate(options: CLIOptions): Promise<void> {
  let json = options.json ?? false
  let quiet = options.quiet ?? false
  let spinner: ReturnType<typeof createSpinner> | null = null
  let cwd = process.cwd()
  let repoRoot = options.recursive ? null : await findRepoRoot(cwd)
  let directories = resolveScanDirectories({
    dir: anchorDirectoryInputs({ dir: options.dir, root: repoRoot, cwd }),
    recursive: options.recursive,
    cwd,
  })
  let normalizedDirectories = directories.map(({ root, dir }) =>
    resolve(root, dir),
  )
  let includeBranches = options.includeBranches ?? false
  let preferTags = options.preferTags ?? false
  let mode = normalizeUpdateMode(options.mode)
  let style = normalizeUpdateStyle(options.style)
  let rawExcludes: string[] = []
  if (Array.isArray(options.exclude)) {
    rawExcludes.push(...options.exclude)
  } else if (typeof options.exclude === 'string') {
    rawExcludes.push(options.exclude)
  }
  let normalizedExcludes = rawExcludes
    .flatMap(item => item.split(','))
    .map(item => item.trim())
    .filter(Boolean)

  try {
    validateCliOptions({ yes: options.yes, json })

    if (!json) {
      console.info(pc.cyan('\n🚀 Actions Up!\n'))
      spinner = createSpinner('Scanning GitHub Actions...').start()
    }

    /**
     * Write the current CLI state as a machine-readable JSON report.
     *
     * @param reportOptions - Report status and update collections to serialize.
     */
    function writeJsonReport({
      actionsToCheckCount,
      blockedByMode = [],
      outdated = [],
      skipped = [],
      scanResult,
      status,
    }: WriteJsonReportOptions): void {
      process.stdout.write(
        `${JSON.stringify(
          buildJsonReport({
            recursive: options.recursive ?? false,
            excludePatterns: normalizedExcludes,
            directories: normalizedDirectories,
            minAge: options.minAge,
            actionsToCheckCount,
            includeBranches,
            blockedByMode,
            preferTags,
            scanResult,
            outdated,
            skipped,
            status,
            style,
            mode,
          }),
          null,
          2,
        )}\n`,
      )
    }

    /**
     * Scan for GitHub Actions in the repository.
     */
    let scanResults =
      options.recursive ?
        await Promise.all(
          directories.map(({ root, dir }) => scanRecursive(root, dir)),
        )
      : await Promise.all(
          directories.map(({ root, dir }) => scanGitHubActions(root, dir)),
        )
    let scanResult = mergeScanResults(scanResults)

    let totalActions = scanResult.actions.length
    let totalWorkflows = scanResult.workflows.size
    let totalCompositeActions = scanResult.compositeActions.size

    spinner?.success(
      `Found ${pc.yellow(totalActions)} actions in ` +
        `${pc.yellow(totalWorkflows)} workflows and ` +
        `${pc.yellow(totalCompositeActions)} composite actions`,
    )

    if (totalActions === 0) {
      if (json) {
        writeJsonReport({
          status: 'no-actions-found',
          actionsToCheckCount: 0,
          scanResult,
        })
        return
      }
      console.info(pc.green('\n✨ No GitHub Actions found in this repository'))
      return
    }

    /**
     * Prepare actions list and apply CLI excludes if provided.
     */
    let actionsToCheck = scanResult.actions

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

    /**
     * Check for updates.
     */
    if (!json) {
      spinner = createSpinner('Checking for updates...').start()
    }

    if (actionsToCheck.length === 0) {
      spinner?.success('No actions to check after excludes')
      if (json) {
        writeJsonReport({
          status: 'nothing-to-check',
          actionsToCheckCount: 0,
          scanResult,
        })
        return
      }
      console.info(pc.green('\n✨ Nothing to check after excludes\n'))
      return
    }

    let token = process.env['GITHUB_TOKEN']
    let githubClient = createGitHubClient(token)

    let updates = await checkUpdates(actionsToCheck, token, {
      client: githubClient,
      includeBranches,
      preferTags,
      style,
    })

    /**
     * Apply ignore comments (file/block/next-line/inline).
     */
    let filtered: typeof updates = []
    await Promise.all(
      updates.map(async update => {
        let ignored = await shouldIgnore(update.action.file, update.action.line)
        if (!ignored) {
          filtered.push(update)
        }
      }),
    )

    /**
     * Skipped entries that should trigger a warning (e.g., branches).
     */
    let skipped = filtered.filter(update => update.status === 'skipped')

    /**
     * Filter outdated actions.
     */
    let outdated = filtered.filter(update => update.hasUpdate)

    /**
     * Block downgrades of SHA-pinned actions detected via inline comments.
     */
    let { blocked: blockedAsDowngrade, kept } = filterDowngradeUpdates(outdated)
    outdated = kept

    /**
     * Filter by minimum age if publishedAt is available.
     */
    let minAgeMs = options.minAge * 24 * 60 * 60 * 1000
    let now = Date.now()
    let blockedByAge: typeof outdated = []
    outdated = outdated.filter(update => {
      if (!update.publishedAt) {
        return true
      }
      let age = now - update.publishedAt.getTime()
      if (age < minAgeMs) {
        blockedByAge.push(update)
        return false
      }
      return true
    })

    let blockedByMode: typeof outdated = []
    if (mode !== 'major') {
      let tagsCache = new Map<
        string,
        Awaited<ReturnType<typeof githubClient.getAllTags>>
      >()
      let shaCache = new Map<string, string | null>()
      let decisions = outdated.map(update => {
        let effectiveCurrentVersion = update.currentVersion
        if (isSha(update.currentVersion)) {
          let inline = parseVersionComment(update.action.comment)
          if (inline) {
            effectiveCurrentVersion = inline
          }
        }

        let level = getUpdateLevel(
          effectiveCurrentVersion,
          update.latestVersion,
        )
        let allowed = (
          mode === 'minor' ?
            ['minor', 'patch', 'none']
          : ['patch', 'none']).includes(level)

        return { effectiveCurrentVersion, allowed, update }
      })

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

    /**
     * Deduplicate resolution per action and version, so repeated occurrences
     * across files do not trigger duplicate API requests.
     */
    let resolutionCache = new Map<string, Promise<ActionUpdate>>()
    outdated = await Promise.all(
      outdated.map(async update => {
        let resolutionKey = [
          update.action.name,
          update.currentVersion,
          update.latestVersion,
          update.latestSha,
        ].join('@')
        let resolution = resolutionCache.get(resolutionKey)
        if (!resolution) {
          resolution = resolveTargetReference(update, {
            client: githubClient,
            style,
            mode,
          })
          resolutionCache.set(resolutionKey, resolution)
        }
        let resolved = await resolution
        return {
          ...update,
          targetRefRateLimited: resolved.targetRefRateLimited,
          targetRefStyle: resolved.targetRefStyle,
          targetRef: resolved.targetRef,
        }
      }),
    )

    /**
     * Drop no-op updates whose resolved target matches the current reference.
     */
    outdated = outdated.filter(
      update => update.targetRef !== update.action.version,
    )
    let unresolvedByStyle = outdated
      .filter(update => !update.targetRef)
      .map(update => ({
        ...update,
        skipReason: 'unsupported-style' as const,
        status: 'skipped' as const,
        hasUpdate: false,
      }))
    skipped.push(...unresolvedByStyle)
    outdated = outdated.filter(update => update.targetRef)

    /**
     * Updates that fell back to exact versions because tag validation was rate
     * limited.
     */
    let rateLimitedFallbacks = outdated.filter(
      update => update.targetRefRateLimited,
    )

    if (outdated.length === 0) {
      spinner?.success('All actions are up to date!')
      if (json) {
        writeJsonReport({
          actionsToCheckCount: actionsToCheck.length,
          status: 'up-to-date',
          blockedByMode,
          scanResult,
          skipped,
        })
        return
      }
      if (!quiet && skipped.length > 0) {
        printSkippedWarning(skipped, includeBranches, style)
      }
      if (!quiet && blockedByMode.length > 0) {
        printModeWarning(blockedByMode, mode)
      }
      if (!quiet && blockedByAge.length > 0) {
        printMinAgeWarning(blockedByAge, options.minAge)
      }
      if (!quiet && blockedAsDowngrade.length > 0) {
        printDowngradeWarning(blockedAsDowngrade, preferTags)
      }
      console.info(
        pc.green('\n✨ Everything is already at the latest version!\n'),
      )
      return
    }

    let breaking = outdated.filter(update => update.isBreaking)

    spinner?.success(
      `Found ${pc.yellow(outdated.length)} updates available${
        breaking.length > 0 ?
          ` (${pc.redBright(breaking.length)} breaking)`
        : ''
      }`,
    )

    if (json) {
      writeJsonReport({
        actionsToCheckCount: actionsToCheck.length,
        status: 'updates-available',
        blockedByMode,
        scanResult,
        outdated,
        skipped,
      })
      return
    }

    if (!quiet && skipped.length > 0) {
      printSkippedWarning(skipped, includeBranches, style)
    }
    if (!quiet && blockedByMode.length > 0) {
      printModeWarning(blockedByMode, mode)
    }
    if (!quiet && blockedByAge.length > 0) {
      printMinAgeWarning(blockedByAge, options.minAge)
    }
    if (!quiet && blockedAsDowngrade.length > 0) {
      printDowngradeWarning(blockedAsDowngrade, preferTags)
    }
    if (!quiet && rateLimitedFallbacks.length > 0) {
      printRateLimitWarning(rateLimitedFallbacks)
    }

    if (options.dryRun) {
      console.info(pc.yellow('\n📋 Dry Run - No changes will be made\n'))

      for (let update of outdated) {
        let target =
          update.targetRefStyle === 'sha' && update.targetRef ?
            `${update.latestVersion} ${pc.gray(`(${update.targetRef.slice(0, 7)})`)}`
          : (update.targetRef ?? update.latestVersion)
        console.info(
          `${pc.cyan(update.action.file ?? 'unknown')}:\n` +
            `${update.action.name}: ${pc.redBright(update.currentVersion)} → ${pc.green(
              target,
            )}\n`,
        )
      }

      console.info(pc.gray(`\n${outdated.length} actions would be updated\n`))
      return
    }

    if (options.yes) {
      /**
       * Auto-update all actions with the resolved target ref.
       */
      let toUpdate = outdated.filter(update => update.targetRef)
      if (toUpdate.length === 0) {
        console.info(pc.yellow('\n⚠️ No actionable updates available\n'))
        return
      }

      console.info(pc.yellow(`\n🔄 Updating ${toUpdate.length} actions...\n`))

      await applyUpdates(toUpdate)
    } else {
      if (
        !quiet &&
        (skipped.length > 0 ||
          blockedByMode.length > 0 ||
          blockedByAge.length > 0 ||
          blockedAsDowngrade.length > 0 ||
          rateLimitedFallbacks.length > 0)
      ) {
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
    }
    console.info(pc.green('\n✓ Updates applied successfully!'))
  } catch (error) {
    spinner?.error('Failed')

    /**
     * Handle rate limit errors with helpful message.
     */
    if (error instanceof Error && error.name === 'GitHubRateLimitError') {
      console.error(pc.yellow('\n⚠️ Rate Limit Exceeded\n'))
      console.error(error.message)
      console.error(pc.gray('\nExample: GITHUB_TOKEN=ghp_xxxx actions-up\n'))
    } else {
      console.error(
        pc.redBright('\nError:'),
        error instanceof Error ? error.message : String(error),
      )
    }
    process.exit(1)
  }
}
