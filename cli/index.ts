import { relative } from 'node:path'

import type { JsonReportStatus } from './build-json-report'
import type { ActionUpdate } from '../types/action-update'
import type { CLIOptions } from './parse-arguments'

import { promptUpdateSelection } from '../core/interactive/prompt-update-selection'
import { buildJsonErrorReport, buildJsonReport } from './build-json-report'
import { normalizeUpdateStyle } from '../core/plan/normalize-update-style'
import { normalizeUpdateMode } from '../core/plan/normalize-update-mode'
import { createUpdatePlan } from '../core/plan/create-update-plan'
import { printRateLimitWarning } from './print-rate-limit-warning'
import { printUnwrittenWarning } from './print-unwritten-warning'
import { printDowngradeWarning } from './print-downgrade-warning'
import { normalizePatternList } from './normalize-pattern-list'
import { applyUpdates } from '../core/ast/update/apply-updates'
import { printLockfileWarning } from './print-lockfile-warning'
import { scanRepository } from '../core/plan/scan-repository'
import { printSkippedWarning } from './print-skipped-warning'
import { printMinAgeWarning } from './print-min-age-warning'
import { validateCliOptions } from './validate-cli-options'
import { printTrustWarning } from './print-trust-warning'
import { printModeWarning } from './print-mode-warning'
import { colors } from '../core/interactive/colors'
import { parseArguments } from './parse-arguments'
import { createSpinner } from './create-spinner'
import { version } from '../package.json'

/**
 * Payload used by the local JSON writer helper in the CLI.
 */
interface WriteJsonReportOptions {
  /**
   * Updates held back as downgrades of SHA pins.
   */
  blockedAsDowngrade?: ActionUpdate[]

  /**
   * Updates held back because their commit failed a trust check.
   */
  blockedByTrust?: ActionUpdate[]

  /**
   * Updates excluded by the selected update mode.
   */
  blockedByMode?: ActionUpdate[]

  /**
   * Updates held back by the release age cool-down.
   */
  blockedByAge?: ActionUpdate[]

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
}

export function run(): Promise<void> {
  let parsed = parseArguments(process.argv.slice(2), version)

  if (parsed.kind === 'help' || parsed.kind === 'version') {
    console.info(parsed.text)
    return Promise.resolve()
  }

  if (parsed.kind === 'error') {
    console.error(colors.redBright('\nError:'), parsed.message)
    process.exitCode = 1
    return Promise.resolve()
  }

  return runUpdate(parsed.options)
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

  try {
    let includeBranches = options.includeBranches ?? false
    let preferTags = options.preferTags ?? false
    let mode = normalizeUpdateMode(options.mode)
    let style = normalizeUpdateStyle(options.style)
    let normalizedExcludes = normalizePatternList(options.exclude)
    let normalizedMinAgeExcludes = normalizePatternList(options.minAgeExclude)

    validateCliOptions({ yes: options.yes, json })

    if (!json) {
      console.info(colors.cyan('\n🚀 Actions Up!\n'))
      spinner = createSpinner('Scanning GitHub Actions...').start()
    }

    /**
     * Scan for GitHub Actions in the repository.
     */
    let { directories, scanResult, lockfiles } = await scanRepository({
      recursive: options.recursive,
      directories: options.dir,
      cwd: process.cwd(),
    })

    /**
     * Write the current CLI state as a machine-readable JSON report.
     *
     * @param reportOptions - Report status and update collections to serialize.
     */
    function writeJsonReport({
      blockedAsDowngrade = [],
      blockedByTrust = [],
      actionsToCheckCount,
      blockedByMode = [],
      blockedByAge = [],
      outdated = [],
      skipped = [],
      status,
    }: WriteJsonReportOptions): void {
      process.stdout.write(
        `${JSON.stringify(
          buildJsonReport({
            minAgeExcludePatterns: normalizedMinAgeExcludes,
            recursive: options.recursive ?? false,
            excludePatterns: normalizedExcludes,
            minAge: options.minAge,
            actionsToCheckCount,
            blockedAsDowngrade,
            includeBranches,
            blockedByTrust,
            blockedByMode,
            blockedByAge,
            directories,
            preferTags,
            scanResult,
            lockfiles,
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

    let totalRunners = scanResult.actions.filter(
      action => action.type === 'runner',
    ).length
    let totalActions = scanResult.actions.length - totalRunners
    let totalWorkflows = scanResult.workflows.size
    let totalCompositeActions = scanResult.compositeActions.size

    spinner?.success(
      `Found ${colors.yellow(totalActions)} ${pluralize(
        totalActions,
        'action',
        'actions',
      )}${
        totalRunners > 0 ?
          ` and ${colors.yellow(totalRunners)} ${pluralize(
            totalRunners,
            'runner',
            'runners',
          )}`
        : ''
      } in ${colors.yellow(totalWorkflows)} ${pluralize(
        totalWorkflows,
        'workflow',
        'workflows',
      )} and ${colors.yellow(totalCompositeActions)} composite ${pluralize(
        totalCompositeActions,
        'action',
        'actions',
      )}`,
    )

    if (!json) {
      for (let lockfile of lockfiles) {
        if (lockfile.error) {
          printLockfileWarning(
            relative(process.cwd(), lockfile.path),
            lockfile.error,
          )
        }
      }
    }

    if (totalActions === 0 && totalRunners === 0) {
      if (json) {
        writeJsonReport({
          status: 'no-actions-found',
          actionsToCheckCount: 0,
        })
        return
      }
      console.info(
        colors.green('\n✨ No GitHub Actions found in this repository'),
      )
      return
    }

    /**
     * Compile the excludes and the cool-down exemptions up front, so an invalid
     * pattern is reported before the update check starts.
     */
    let excludes: RegExp[] = []
    let minAgeExcludes: RegExp[] = []

    if (normalizedExcludes.length > 0) {
      let { parseExcludePatterns } =
        await import('../core/filters/parse-exclude-patterns')
      excludes = parseExcludePatterns(normalizedExcludes)
    }

    if (normalizedMinAgeExcludes.length > 0) {
      let { parseExcludePatterns } =
        await import('../core/filters/parse-exclude-patterns')
      minAgeExcludes = parseExcludePatterns(normalizedMinAgeExcludes)
    }

    /**
     * Check for updates.
     */
    if (!json) {
      spinner = createSpinner('Checking for updates...').start()
    }

    let plan = await createUpdatePlan(scanResult, {
      token: process.env['GITHUB_TOKEN'],
      minAge: options.minAge,
      includeBranches,
      minAgeExcludes,
      preferTags,
      excludes,
      style,
      mode,
    })

    if (plan.status === 'nothing-to-check') {
      spinner?.success('No entries to check after excludes')
      if (json) {
        writeJsonReport({
          status: 'nothing-to-check',
          actionsToCheckCount: 0,
        })
        return
      }
      console.info(colors.green('\n✨ Nothing to check after excludes\n'))
      return
    }

    let {
      blockedAsDowngrade,
      blockedByTrust,
      blockedByMode,
      blockedByAge,
      skipped,
    } = plan

    /**
     * Runners reach the preview, the prompt and the writer exactly like an
     * action update, after the actions.
     */
    let outdated = [...plan.updates, ...plan.runners]

    /**
     * Updates that fell back to exact versions because tag validation was rate
     * limited.
     */
    let rateLimitedFallbacks = outdated.filter(
      update => update.targetRefRateLimited,
    )

    /**
     * Entries carrying tags that failed a trust check: the ones held back for
     * it, and the ones that stepped down past such a tag.
     */
    let trustEntries = [
      ...blockedByTrust,
      ...outdated.filter(update => update.trustHolds?.length),
    ]

    /**
     * Print a notice for every group of entries that was skipped, held back or
     * pinned to a fallback reference, unless quiet output was requested. Tags
     * that failed a trust check are reported last and even then, since they
     * call for a look at the repository before anything else.
     */
    function printWarnings(): void {
      if (!quiet) {
        if (skipped.length > 0) {
          printSkippedWarning(skipped, includeBranches, style)
        }
        if (blockedByMode.length > 0) {
          printModeWarning(blockedByMode, mode)
        }
        if (blockedByAge.length > 0) {
          printMinAgeWarning(blockedByAge, options.minAge)
        }
        if (blockedAsDowngrade.length > 0) {
          printDowngradeWarning(blockedAsDowngrade, preferTags)
        }
        if (rateLimitedFallbacks.length > 0) {
          printRateLimitWarning(rateLimitedFallbacks)
        }
      }
      printTrustWarning(trustEntries)
    }

    if (outdated.length === 0) {
      spinner?.success('All actions are up to date!')
      if (json) {
        writeJsonReport({
          actionsToCheckCount: plan.actionsChecked,
          status: 'up-to-date',
          blockedAsDowngrade,
          blockedByTrust,
          blockedByMode,
          blockedByAge,
          skipped,
        })
        printTrustWarning(trustEntries)
        return
      }
      printWarnings()
      if (trustEntries.length === 0) {
        console.info(
          colors.green('\n✨ Everything is already at the latest version!\n'),
        )
      }
      return
    }

    let breaking = outdated.filter(update => update.isBreaking)

    spinner?.success(
      `Found ${colors.yellow(outdated.length)} ${pluralize(
        outdated.length,
        'update',
        'updates',
      )} available${
        breaking.length > 0 ?
          ` (${colors.redBright(breaking.length)} breaking)`
        : ''
      }`,
    )

    if (json) {
      writeJsonReport({
        actionsToCheckCount: plan.actionsChecked,
        status: 'updates-available',
        blockedAsDowngrade,
        blockedByTrust,
        blockedByMode,
        blockedByAge,
        outdated,
        skipped,
      })
      printTrustWarning(trustEntries)
      return
    }

    printWarnings()

    if (options.dryRun) {
      console.info(colors.yellow('\n📋 Dry Run - No changes will be made\n'))

      for (let update of outdated) {
        let target =
          update.targetRefStyle === 'sha' && update.targetRef ?
            `${update.latestVersion} ${colors.gray(`(${update.targetRef.slice(0, 7)})`)}`
          : update.targetRef
        console.info(
          `${colors.cyan(update.action.file ?? 'unknown')}:\n` +
            `${update.action.name}: ${colors.redBright(update.currentVersion)} → ${colors.green(
              target,
            )}\n`,
        )
      }

      let noun = pluralize(outdated.length, 'entry', 'entries')
      console.info(
        colors.gray(`\n${outdated.length} ${noun} would be updated\n`),
      )
      return
    }

    let requested: ActionUpdate[]

    if (options.yes) {
      /**
       * Auto-update every eligible entry, actions and runners alike.
       */
      console.info(
        colors.yellow(
          `\n🔄 Updating ${outdated.length} ${pluralize(
            outdated.length,
            'entry',
            'entries',
          )}...\n`,
        ),
      )

      requested = outdated
    } else {
      if (
        (!quiet &&
          (skipped.length > 0 ||
            blockedByMode.length > 0 ||
            blockedByAge.length > 0 ||
            blockedAsDowngrade.length > 0 ||
            rateLimitedFallbacks.length > 0)) ||
        trustEntries.length > 0
      ) {
        console.info('')
      }

      let selected = await promptUpdateSelection(outdated, {
        showAge: options.minAge > 0,
      })

      if (!selected || selected.length === 0) {
        console.info(colors.gray('\nNo updates applied'))
        return
      }

      console.info(
        colors.yellow(
          `\n🔄 Updating ${selected.length} selected ${pluralize(
            selected.length,
            'entry',
            'entries',
          )}...\n`,
        ),
      )

      requested = selected
    }

    let unwritten = await applyUpdates(requested)

    if (unwritten.length === 0) {
      console.info(colors.green('\n✓ Updates applied successfully!'))
      return
    }

    /**
     * An entry the writer could not find where the scan reported it was not
     * applied, so the run reports it and fails instead of claiming success.
     */
    let writtenCount = requested.length - unwritten.length
    if (writtenCount > 0) {
      console.info(
        colors.green(
          `\n✓ ${writtenCount} of ${requested.length} ${pluralize(
            requested.length,
            'entry',
            'entries',
          )} applied`,
        ),
      )
    }
    printUnwrittenWarning(unwritten, requested.length)
    process.exitCode = 1
  } catch (error) {
    spinner?.error('Failed')

    /**
     * A consumer of `--json` still gets a document to parse, naming why the run
     * failed. The terminal notice below goes to stderr as before.
     */
    if (json) {
      process.stdout.write(
        `${JSON.stringify(buildJsonErrorReport(error), null, 2)}\n`,
      )
    }

    /**
     * Handle rate limit errors with helpful message.
     */
    if (error instanceof Error && error.name === 'GitHubRateLimitError') {
      console.error(colors.yellow('\n⚠️ Rate Limit Exceeded\n'))
      console.error(error.message)
      console.error(
        colors.gray('\nExample: GITHUB_TOKEN=ghp_xxxx actions-up\n'),
      )
    } else {
      console.error(
        colors.redBright('\nError:'),
        error instanceof Error ? error.message : String(error),
      )
    }
    process.exitCode = 1
  }
}

/**
 * Selects the English singular or plural form for a count.
 *
 * @param count - Number the noun describes.
 * @param singular - Form used for exactly one.
 * @param plural - Form used for every other count.
 * @returns The form matching the count.
 */
function pluralize(count: number, singular: string, plural: string): string {
  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  return pluralRules.select(count) === 'one' ? singular : plural
}
