import pc from 'picocolors'

/**
 * Prints a warning message for actions that were skipped during scanning.
 *
 * @param skipped - Array of skipped actions with their current versions.
 * @param includeBranches - Whether branch-pinned actions are being checked.
 */
export function printSkippedWarning(
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
