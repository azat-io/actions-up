import type { ActionUpdate } from '../types/action-update'
import type { TrustHold } from '../types/trust-hold'

import { colors } from '../core/interactive/colors'

/**
 * What each trust check found, worded for the notice.
 */
const FINDINGS: Record<TrustHold['reason'], string> = {
  'unreachable-commit':
    'commit was found on neither the default branch nor a protected branch',
  'tag-moved': 'tag now points at another commit than the pin',
}

/**
 * Prints the notice for tags held back because their commit failed a trust
 * check.
 *
 * Unlike the other notices it goes to stderr and is printed even with `--quiet`
 * and `--json`: a moved tag or a commit outside the history of the repository
 * is what a hijacked action looks like, and the repository needs a look before
 * any version of it is taken. Each tag is named with the commit it points at.
 * An update that stepped down past it says which version it offers instead, and
 * a workflow that references the tag itself is already running that commit.
 *
 * @param entries - Updates carrying trust holds: held back, or stepped down to
 *   an older version.
 */
export function printTrustWarning(
  entries: {
    action: { version?: string | null; name: string }
    holdReason?: ActionUpdate['holdReason']
    latestVersion: string | null
    trustHolds?: TrustHold[]
  }[],
): void {
  let counts = new Map<string, number>()

  for (let { trustHolds = [], latestVersion, holdReason, action } of entries) {
    let offered =
      holdReason === undefined ? `; ${latestVersion} offered instead` : ''

    for (let { version, reason, sha } of trustHolds) {
      let running =
        action.version === version ? '; the workflow already runs it' : ''
      let line =
        `${action.name}@${version} → ${sha.slice(0, 7)}: ` +
        `${FINDINGS[reason]}${offered}${running}`
      counts.set(line, (counts.get(line) ?? 0) + 1)
    }
  }

  if (counts.size === 0) {
    return
  }

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let tagNoun = pluralRules.select(counts.size) === 'one' ? 'tag' : 'tags'

  console.warn(
    colors.redBright(
      `\n🚨 Skipped ${counts.size} ${tagNoun} that failed a security check. ` +
        'Review these repositories manually before updating:',
    ),
  )
  for (let [line, count] of counts) {
    let suffix = count > 1 ? ` (×${count})` : ''
    console.warn(colors.redBright(`   • ${line}${suffix}`))
  }
}
