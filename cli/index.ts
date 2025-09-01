import { createSpinner } from 'nanospinner'
import 'node:worker_threads'
import pc from 'picocolors'
import cac from 'cac'

import { promptUpdateSelection } from '../core/interactive/prompt-update-selection'
import { applyUpdates } from '../core/ast/update/apply-updates'
import { checkUpdates } from '../core/api/check-updates'
import { scanGitHubActions } from '../core/index'
import { version } from '../package.json'

/** CLI Options. */
interface CLIOptions {
  /** Preview changes without applying them. */
  dryRun: boolean

  /** Skip all confirmations. */
  yes: boolean
}

/** Run the CLI. */
export function run(): void {
  let cli = cac('actions-up')

  cli
    .help()
    .version(version)
    .option('--yes, -y', 'Skip all confirmations')
    .option('--dry-run', 'Preview changes without applying them')
    .command('', 'Update GitHub Actions')
    .action(async (options: CLIOptions) => {
      console.info(pc.cyan('\n🚀 Actions Up!\n'))

      let spinner = createSpinner('Scanning GitHub Actions...').start()

      try {
        /* Scan for GitHub Actions in the repository */
        let scanResult = await scanGitHubActions(process.cwd())

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

        /* Check for updates */
        spinner = createSpinner('Checking for updates...').start()

        let updates = await checkUpdates(
          scanResult.actions,
          process.env['GITHUB_TOKEN'],
        )

        /* Filter outdated actions */
        let outdated = updates.filter(update => update.hasUpdate)
        let breaking = outdated.filter(update => update.isBreaking)

        if (outdated.length === 0) {
          spinner.success('All actions are up to date!')
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
          /* Auto-update all actions with SHA */
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
          let selected = await promptUpdateSelection(updates)

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

        /* Handle rate limit errors with helpful message */
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
