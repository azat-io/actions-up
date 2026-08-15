import pc from 'picocolors'

import type { UpdateMode } from '../types/update-mode'

import { groupByIdentifier } from './group-by-identifier'

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

  let grouped = groupByIdentifier(blocked)

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let form = pluralRules.select(grouped.length)
  let noun = form === 'one' ? 'action' : 'actions'
  let label = mode === 'minor' ? 'major' : 'major/minor'

  console.info(
    pc.yellow(
      `\n⚠️  Skipped ${grouped.length} ${noun} due to ${label} updates`,
    ),
  )
  for (let { identifier, count } of grouped) {
    let suffix = count > 1 ? ` (×${count})` : ''
    console.info(pc.gray(`   • ${identifier}${suffix}`))
  }
}
