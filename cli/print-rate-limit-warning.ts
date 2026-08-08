import pc from 'picocolors'

/**
 * Prints a notice for updates whose floating tag validation was rate limited.
 *
 * @param affected - Array of updates that fell back to exact versions because
 *   the GitHub API rate limit prevented tag validation.
 */
export function printRateLimitWarning(
  affected: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
): void {
  if (affected.length === 0) {
    return
  }

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let updateNoun =
    pluralRules.select(affected.length) === 'one' ? 'update' : 'updates'

  console.info(
    pc.gray(
      `\n⚠️ Tag validation was rate limited for ${affected.length} ` +
        `${updateNoun}; exact versions were written instead of floating tags`,
    ),
  )
  for (let update of affected) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    console.info(pc.gray(`   • ${identifier}`))
  }
}
