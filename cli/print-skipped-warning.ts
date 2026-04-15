import pc from 'picocolors'

import type { UpdateStyle } from '../types/update-style'

/**
 * Prints a warning message for actions that were skipped during scanning.
 *
 * @param skipped - Array of skipped actions with their current versions.
 * @param includeBranches - Whether branch-pinned actions are being checked.
 * @param style - Effective update style for the current run.
 */
export function printSkippedWarning(
  skipped: {
    action: { version?: string | null; uses?: string; name: string }
    skipReason?: 'unsupported-style' | 'unknown' | 'branch'
    currentVersion: string | null
  }[],
  includeBranches: boolean,
  style: UpdateStyle,
): void {
  let branchSkipped = skipped.filter(
    update => update.skipReason === 'branch' || update.skipReason === undefined,
  )
  let unsupportedStyleSkipped = skipped.filter(
    update => update.skipReason === 'unsupported-style',
  )

  if (branchSkipped.length > 0) {
    printSkippedGroup(
      branchSkipped,
      includeBranches ? 'pinned to branches' : (
        'pinned to branches (use --include-branches to check them)'
      ),
    )
  }

  if (unsupportedStyleSkipped.length > 0) {
    let reason =
      style === 'preserve' ?
        'whose current ref style could not be preserved'
      : 'that could not be updated with the current style'
    printSkippedGroup(unsupportedStyleSkipped, reason)
  }
}

function printSkippedGroup(
  skipped: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
  reason: string,
): void {
  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let form = pluralRules.select(skipped.length)
  let noun = form === 'one' ? 'action' : 'actions'

  console.info(pc.yellow(`\n⚠️  Skipped ${skipped.length} ${noun} ${reason}`))
  for (let update of skipped) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    console.info(pc.gray(`   • ${identifier}`))
  }
}
