import pc from 'picocolors'

import { groupByIdentifier } from './group-by-identifier'

/**
 * Prints a notice for updates blocked because they would downgrade SHA-pinned
 * actions to an older resolved version.
 *
 * @param blocked - Array of actions whose resolved latest version is older than
 *   the version pinned in the file.
 */
export function printDowngradeWarning(
  blocked: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
): void {
  if (blocked.length === 0) {
    return
  }

  let grouped = groupByIdentifier(blocked)

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let isSingle = pluralRules.select(grouped.length) === 'one'
  let updateNoun = isSingle ? 'update' : 'updates'
  let actionNoun = isSingle ? 'a SHA-pinned action' : 'SHA-pinned actions'

  console.info(
    pc.gray(
      `\n⛔ Skipped ${grouped.length} ${updateNoun} that would downgrade ` +
        `${actionNoun} (resolved latest version is older than the pinned ` +
        `version, try --prefer-tags)`,
    ),
  )
  for (let { identifier, count } of grouped) {
    let suffix = count > 1 ? ` (×${count})` : ''
    console.info(pc.gray(`   • ${identifier}${suffix}`))
  }
}
