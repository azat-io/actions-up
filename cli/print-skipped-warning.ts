import type { RelockBlocker } from '../types/relock-blocker'
import type { ActionUpdate } from '../types/action-update'
import type { UpdateStyle } from '../types/update-style'
import type { LockTool } from '../types/lock-tool'

import { MIN_LOCK_TOOL_VERSION } from '../core/constants'
import { groupByIdentifier } from './group-by-identifier'
import { colors } from '../core/interactive/colors'

/**
 * What to do so that gh-actions-lock can regenerate the lockfiles that pin the
 * skipped actions, or why it was not looked for, by why it cannot be run.
 */
const LOCK_TOOL_HINTS: Record<Exclude<LockTool, 'available'>, string> = {
  'no-gh':
    'install the GitHub CLI from https://cli.github.com and run gh extension install github/gh-actions-lock to update them',
  outdated: `run gh extension upgrade gh-actions-lock --force to update them; v${MIN_LOCK_TOOL_VERSION} or later is needed`,
  unauthenticated:
    'run gh auth login or set GH_TOKEN, so that gh can run gh-actions-lock, to update them',
  unlisted:
    'gh could not list its extensions, so gh-actions-lock was not looked for',
  missing: 'run gh extension install github/gh-actions-lock to update them',
}

/**
 * Why the lockfiles that pin an action cannot be regenerated for it, as the
 * warning puts it, in the order the warning lists them.
 */
const LOCKFILE_SKIP_REASONS: [blocker: RelockBlocker, reason: string][] = [
  [
    'unreadable',
    'pinned by a workflow lockfile that cannot be regenerated for them, since it, a workflow it tracks or an action of the repository cannot be read',
  ],
  [
    'unrecorded',
    'in workflows that run actions through ./, or in the actions they run, which gh actions-lock does not lock (for an action of the repository change ./ to $/, which gh actions-lock --migrate-local-actions does in workflows, not in action files; an action that is checked out while the workflow runs cannot be locked)',
  ],
  [
    'shared',
    'pinned by the workflow lockfiles of more than one repository root, which Actions Up does not regenerate together',
  ],
]

/**
 * Prints a warning message for actions that were skipped during scanning.
 *
 * @param skipped - Array of skipped actions with their current versions.
 * @param options - What the run checked and how.
 * @param options.includeBranches - Whether branch-pinned actions are being
 *   checked.
 * @param options.style - Effective update style for the current run.
 * @param options.lockTool - Whether gh-actions-lock can regenerate workflow
 *   lockfiles, and why not, when the run looked for it. A tool that cannot be
 *   run is why the updates the lockfiles pin were skipped, unless they cannot
 *   be regenerated anyway.
 * @param options.relockBlockers - Scanned files whose lockfiles cannot all be
 *   regenerated for them, each with why.
 */
export function printSkippedWarning(
  skipped: {
    action: {
      version?: string | null
      file?: string
      uses?: string
      name: string
    }
    skipReason?: ActionUpdate['skipReason']
    currentVersion: string | null
  }[],
  options: {
    relockBlockers?: Map<string, RelockBlocker>
    lockTool?: LockTool | null
    includeBranches: boolean
    style: UpdateStyle
  },
): void {
  let {
    relockBlockers = new Map<string, RelockBlocker>(),
    includeBranches,
    lockTool,
    style,
  } = options
  let branchSkipped = skipped.filter(
    update => update.skipReason === 'branch' || update.skipReason === undefined,
  )
  let unsupportedStyleSkipped = skipped.filter(
    update => update.skipReason === 'unsupported-style',
  )
  let tagFamilySkipped = skipped.filter(
    update => update.skipReason === 'tag-family',
  )
  let notComparableSkipped = skipped.filter(
    update => update.skipReason === 'not-comparable',
  )
  let notFoundSkipped = skipped.filter(
    update => update.skipReason === 'not-found',
  )
  let referenceTypeSkipped = skipped.filter(
    update => update.skipReason === 'ref-type-unavailable',
  )
  let checkFailedSkipped = skipped.filter(
    update => update.skipReason === 'check-failed',
  )
  let shaUnresolvedSkipped = skipped.filter(
    update => update.skipReason === 'sha-unresolved',
  )
  let reachabilityUnknownSkipped = skipped.filter(
    update => update.skipReason === 'reachability-unknown',
  )
  let releaseUnresolvedSkipped = skipped.filter(
    update => update.skipReason === 'release-unresolved',
  )
  let lockfileSkipped = skipped.filter(
    update => update.skipReason === 'lockfile',
  )
  let lockfileUncheckedSkipped = skipped.filter(
    update => update.skipReason === 'lockfile-unchecked',
  )

  /**
   * Every reason without a dedicated group still has to reach the user, so a
   * new `skipReason` is reported here until it gets its own wording instead of
   * disappearing from the output.
   */
  let groupedReasons = new Set([
    'reachability-unknown',
    'ref-type-unavailable',
    'release-unresolved',
    'lockfile-unchecked',
    'unsupported-style',
    'not-comparable',
    'sha-unresolved',
    'check-failed',
    'tag-family',
    'not-found',
    'lockfile',
    'branch',
  ])
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

  if (notComparableSkipped.length > 0) {
    printSkippedGroup(
      notComparableSkipped,
      'that cannot be compared with the latest tag as versions (check them manually)',
    )
  }

  if (notFoundSkipped.length > 0) {
    printSkippedGroup(
      notFoundSkipped,
      'whose repository was not found (private repositories need a GITHUB_TOKEN with access)',
    )
  }

  if (referenceTypeSkipped.length > 0) {
    printSkippedGroup(
      referenceTypeSkipped,
      'whose reference type could not be resolved (GitHub API request failed)',
    )
  }

  if (checkFailedSkipped.length > 0) {
    printSkippedGroup(
      checkFailedSkipped,
      'whose update check failed (see warnings above)',
    )
  }

  if (shaUnresolvedSkipped.length > 0) {
    printSkippedGroup(
      shaUnresolvedSkipped,
      'whose tag could not be resolved to a commit (missing tag or failed GitHub API request)',
    )
  }

  if (reachabilityUnknownSkipped.length > 0) {
    printSkippedGroup(
      reachabilityUnknownSkipped,
      'whose commit could not be checked against the repository history (failed GitHub API request or too many protected branches)',
    )
  }

  if (releaseUnresolvedSkipped.length > 0) {
    printSkippedGroup(
      releaseUnresolvedSkipped,
      'whose tag now points at another commit than the pin and whose release could not be read (failed GitHub API request)',
    )
  }

  let blockedSkipped = Map.groupBy(
    lockfileSkipped,
    update => relockBlockers.get(update.action.file ?? '') ?? null,
  )
  let toolSkipped = blockedSkipped.get(null) ?? []
  if (toolSkipped.length > 0) {
    printSkippedGroup(
      toolSkipped,
      lockTool && lockTool !== 'available' ?
        `pinned by a workflow lockfile (${LOCK_TOOL_HINTS[lockTool]})`
      : 'pinned by a workflow lockfile',
    )
  }
  for (let [blocker, reason] of LOCKFILE_SKIP_REASONS) {
    let group = blockedSkipped.get(blocker) ?? []
    if (group.length > 0) {
      printSkippedGroup(group, reason)
    }
  }

  if (lockfileUncheckedSkipped.length > 0) {
    printSkippedGroup(
      lockfileUncheckedSkipped,
      'pinned by a workflow lockfile to a commit that was not compared with the latest version (gh actions-lock --relock moves such pins forward)',
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

  console.info(
    colors.yellow(`\n⚠️  Skipped ${grouped.length} ${noun} ${reason}`),
  )
  for (let { identifier, count } of grouped) {
    let suffix = count > 1 ? ` (×${count})` : ''
    console.info(colors.gray(`   • ${identifier}${suffix}`))
  }
}
