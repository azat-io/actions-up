import pc from 'picocolors'

import type { UpdateMode } from '../types/update-mode'

/**
 * Prints a warning message for actions that were skipped due to update mode
 * restrictions.
 *
 * @param blocked - Array of blocked actions with their current versions.
 * @param mode - The current update mode (patch/minor/major).
 */
export function printModeWarning(
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
