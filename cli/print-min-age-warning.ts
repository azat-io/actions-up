import type { ActionUpdate } from '../types/action-update'

import { groupByIdentifier } from './group-by-identifier'
import { colors } from '../core/interactive/colors'

/**
 * Prints a notice for updates held back by the minimum age cool-down.
 *
 * An update whose age could not be established is listed apart from one that is
 * too recent: the cool-down holds both back, but only the first one says
 * nothing about how old the version is.
 *
 * @param blocked - Array of actions whose latest updates are younger than the
 *   minimum age, or whose age is unknown.
 * @param minAge - Minimum update age in days for the current run.
 */
export function printMinAgeWarning(
  blocked: {
    action: { version?: string | null; uses?: string; name: string }
    holdReason?: ActionUpdate['holdReason']
    currentVersion: string | null
  }[],
  minAge: number,
): void {
  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let dayNoun = pluralRules.select(minAge) === 'one' ? 'day' : 'days'
  let hint =
    '(cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)'

  printGroup(
    blocked.filter(update => update.holdReason !== 'age-unknown'),
    `released less than ${minAge} ${dayNoun} ago ${hint}`,
  )
  printGroup(
    blocked.filter(update => update.holdReason === 'age-unknown'),
    `whose age could not be established ${hint}`,
  )
}

/**
 * Prints one group of held-back updates under a header.
 *
 * @param blocked - Updates of the group.
 * @param reason - Why the group was held back.
 */
function printGroup(
  blocked: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
  reason: string,
): void {
  if (blocked.length === 0) {
    return
  }

  let grouped = groupByIdentifier(blocked)

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let updateNoun =
    pluralRules.select(grouped.length) === 'one' ? 'update' : 'updates'

  console.info(
    colors.gray(`\n⏳ Skipped ${grouped.length} ${updateNoun} ${reason}`),
  )
  for (let { identifier, count } of grouped) {
    let suffix = count > 1 ? ` (×${count})` : ''
    console.info(colors.gray(`   • ${identifier}${suffix}`))
  }
}
