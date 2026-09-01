import pc from 'picocolors'

import type { ActionUpdate } from '../types/action-update'
import type { UpdateStyle } from '../types/update-style'

import { groupByIdentifier } from './group-by-identifier'

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
    skipReason?: ActionUpdate['skipReason']
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
  let tagFamilySkipped = skipped.filter(
    update => update.skipReason === 'tag-family',
  )

  /**
   * Every reason without a dedicated group still has to reach the user, so a
   * new `skipReason` is reported here until it gets its own wording instead of
   * disappearing from the output.
   */
  let groupedReasons = new Set(['unsupported-style', 'tag-family', 'branch'])
  let otherSkipped = skipped.filter(
    update =>
      update.skipReason !== undefined && !groupedReasons.has(update.skipReason),
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

  if (tagFamilySkipped.length > 0) {
    printSkippedGroup(
      tagFamilySkipped,
      'whose tag family differs from the latest release (check them manually)',
    )
  }

  if (otherSkipped.length > 0) {
    printSkippedGroup(otherSkipped, 'that could not be checked')
  }
}

function printSkippedGroup(
  skipped: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
  reason: string,
): void {
  let grouped = groupByIdentifier(skipped)

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let form = pluralRules.select(grouped.length)
  let noun = form === 'one' ? 'action' : 'actions'

  console.info(pc.yellow(`\n⚠️  Skipped ${grouped.length} ${noun} ${reason}`))
  for (let { identifier, count } of grouped) {
    let suffix = count > 1 ? ` (×${count})` : ''
    console.info(pc.gray(`   • ${identifier}${suffix}`))
  }
}
