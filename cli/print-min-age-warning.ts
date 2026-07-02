import pc from 'picocolors'

/**
 * Prints a notice for updates held back by the minimum age cool-down.
 *
 * @param blocked - Array of actions whose latest updates are younger than the
 *   minimum age.
 * @param minAge - Minimum update age in days for the current run.
 */
export function printMinAgeWarning(
  blocked: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
  minAge: number,
): void {
  if (blocked.length === 0) {
    return
  }

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let updateNoun =
    pluralRules.select(blocked.length) === 'one' ? 'update' : 'updates'
  let dayNoun = pluralRules.select(minAge) === 'one' ? 'day' : 'days'

  console.info(
    pc.gray(
      `\n⏳ Skipped ${blocked.length} ${updateNoun} released less than ` +
        `${minAge} ${dayNoun} ago (cool-down, use --min-age 0 to disable)`,
    ),
  )
  for (let update of blocked) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    console.info(pc.gray(`   • ${identifier}`))
  }
}
