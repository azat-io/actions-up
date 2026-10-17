import type { UpdatePlanStatus, UpdatePlan } from '../../types/update-plan'
import type { CompatibleUpdate } from '../api/get-compatible-update'
import type { ActionUpdate } from '../../types/action-update'
import type { UpdateStyle } from '../../types/update-style'
import type { ScanResult } from '../../types/scan-result'
import type { UpdateMode } from '../../types/update-mode'

import { resolveTargetReference } from '../updates/resolve-target-reference'
import { parseVersionComment } from '../versions/parse-version-comment'
import { filterDowngradeUpdates } from './filter-downgrade-updates'
import { matchesAnyPattern } from '../filters/matches-any-pattern'
import { getCompatibleUpdate } from '../api/get-compatible-update'
import { createGitHubClient } from '../api/create-github-client'
import { getRunnerUpdate } from '../runners/get-runner-update'
import { getUpdateLevel } from '../versions/get-update-level'
import { shouldIgnore } from '../ignore/should-ignore'
import { checkUpdates } from '../api/check-updates'
import { isSha } from '../versions/is-sha'

/**
 * Policy a plan applies to the scanned entries.
 */
interface CreateUpdatePlanOptions {
  /**
   * Patterns of actions that skip the cool-down but still follow the mode.
   */
  minAgeExcludes: RegExp[]

  /**
   * Whether actions pinned to branches are checked too.
   */
  includeBranches: boolean

  /**
   * Whether tags are compared with releases.
   */
  preferTags: boolean

  /**
   * Patterns of actions and runners to leave out.
   */
  excludes: RegExp[]

  /**
   * How an update is written.
   */
  style: UpdateStyle

  /**
   * Which updates are allowed.
   */
  mode: UpdateMode

  /**
   * GitHub token, when one was given.
   */
  token?: string

  /**
   * Minimum age of a release in days; 0 disables the cool-down.
   */
  minAge: number
}

/**
 * Milliseconds in a day, the unit of `minAge`.
 */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Plan the updates of the scanned entries: check them against GitHub, apply the
 * ignore comments, the downgrade guard, the update mode, the cool-down and the
 * update style, and sort every entry into what can be written and what was left
 * out.
 *
 * @param scanResult - Actions and runners a scan found.
 * @param options - Policy to apply.
 * @returns Updates that can be written and the entries left out.
 * @throws GitHubRateLimitError - When GitHub refused a request the plan needed
 *   because a rate limit was exhausted.
 */
export async function createUpdatePlan(
  scanResult: ScanResult,
  options: CreateUpdatePlanOptions,
): Promise<UpdatePlan> {
  let { includeBranches, minAgeExcludes, preferTags, excludes, style, mode } =
    options

  /**
   * Runner labels ride along in the scan result but resolve from a local table,
   * so they are split off before any lookup and merged back in at the end.
   */
  let scannedRunners = scanResult.actions.filter(
    action => action.type === 'runner',
  )
  let scannedActions = scanResult.actions.filter(
    action => action.type !== 'runner',
  )

  if (scannedActions.length === 0 && scannedRunners.length === 0) {
    return createEmptyPlan('no-actions-found')
  }

  /**
   * Runner entries are named `runner/<family>`, so the same patterns that
   * exclude actions can exclude runners too.
   */
  let actionsToCheck = scannedActions.filter(
    action => !matchesAnyPattern(action.name, excludes),
  )
  let runnersToCheck = scannedRunners.filter(
    runner => !matchesAnyPattern(runner.name, excludes),
  )

  if (actionsToCheck.length === 0 && runnersToCheck.length === 0) {
    return createEmptyPlan('nothing-to-check')
  }

  let githubClient = createGitHubClient(options.token)

  let updates = await checkUpdates(actionsToCheck, options.token, {
    client: githubClient,
    includeBranches,
    preferTags,
    style,
  })

  /**
   * Runner labels resolve from a local table and have no release behind them,
   * so they skip every stage that reasons about refs: the cool-down has no
   * publish date to measure, downgrade detection reads inline version comments,
   * and target ref resolution turns a tag into a SHA.
   */
  let runnerUpdates: ActionUpdate[] = runnersToCheck.flatMap(runner => {
    let currentLabel = runner.version ?? ''
    let targetLabel = getRunnerUpdate(currentLabel)
    if (!targetLabel) {
      return []
    }
    return [
      {
        currentVersion: currentLabel,
        latestVersion: targetLabel,
        targetRef: targetLabel,
        targetRefStyle: 'tag',
        publishedAt: null,
        isBreaking: true,
        latestSha: null,
        hasUpdate: true,
        action: runner,
        status: 'ok',
      } satisfies ActionUpdate,
    ]
  })

  /**
   * Apply ignore comments (file/block/next-line/inline). The checks run in
   * parallel, but the kept entries stay in scan order, so every run lists them
   * the same way.
   */
  let filtered = await dropIgnoredUpdates(updates)
  let filteredRunners = await dropIgnoredUpdates(runnerUpdates)

  /**
   * Skipped entries that should trigger a warning (e.g., branches).
   */
  let skipped = filtered.filter(update => update.status === 'skipped')

  /**
   * Filter outdated actions.
   */
  let outdated = filtered.filter(update => update.hasUpdate)

  /**
   * Block downgrades of SHA-pinned actions detected via inline comments.
   */
  let { blocked: blockedAsDowngrade, kept } = filterDowngradeUpdates(outdated)
  outdated = kept

  /**
   * Resolve the update mode and the release age cool-down together. An action
   * held back by either constraint steps down to the newest release that clears
   * both, and is reported as blocked only when no release does. Actions matched
   * by `--min-age-exclude` skip the cool-down but still follow the update
   * mode.
   */
  let minAgeMs = options.minAge * DAY_MS
  let now = Date.now()

  /**
   * Deduplicate the compatible lookup per action and version. The same blocked
   * action can appear in many workflows, and each lookup walks the tags of the
   * repository. Promises are stored rather than values, so occurrences that
   * start together share one walk. The cool-down exemption depends only on the
   * action name, which is part of the key, so an exempt and a held-back action
   * never share an entry.
   */
  let compatibleCache = new Map<string, Promise<CompatibleUpdate>>()

  let decisions = await Promise.all(
    outdated.map(async update => {
      /**
       * A commit SHA names no version, so a SHA pin is measured from its
       * version comment. Without one the update level is unknown and the minor
       * and patch modes hold the pin back, rather than reading a version out of
       * the digits of the hash.
       */
      let effectiveCurrentVersion =
        isSha(update.currentVersion) ?
          parseVersionComment(update.action.comment)
        : update.currentVersion

      let level = getUpdateLevel(effectiveCurrentVersion, update.latestVersion)
      let allowedByMode =
        mode === 'major' ||
        (mode === 'minor' ?
          ['minor', 'patch', 'none']
        : ['patch', 'none']
        ).includes(level)
      let isAgeExempt = matchesAnyPattern(update.action.name, minAgeExcludes)
      let allowedByAge =
        isAgeExempt ||
        !update.publishedAt ||
        now - update.publishedAt.getTime() >= minAgeMs

      if (allowedByMode && allowedByAge) {
        return { blockedBy: null, update }
      }

      let compatibleKey = [
        update.action.name,
        effectiveCurrentVersion,
        update.latestVersion,
      ].join('@')
      let pending = compatibleCache.get(compatibleKey)
      if (!pending) {
        pending = getCompatibleUpdate(githubClient, {
          currentVersion: effectiveCurrentVersion,
          minAgeMs: isAgeExempt ? 0 : minAgeMs,
          latestVersion: update.latestVersion,
          actionName: update.action.name,
          mode,
          now,
        })
        compatibleCache.set(compatibleKey, pending)
      }
      let compatible = await pending

      if (!compatible.update) {
        /**
         * The cool-down owns the outcome whenever the mode itself had a
         * candidate to offer, so the notice names the constraint that actually
         * held the action back.
         */
        let blockedBy: 'mode' | 'age' =
          allowedByMode || compatible.reason === 'cool-down' ? 'age' : 'mode'
        return { blockedBy, update }
      }

      return {
        update: {
          ...update,
          isBreaking:
            getUpdateLevel(
              effectiveCurrentVersion,
              compatible.update.version,
            ) === 'major',
          publishedAt: compatible.update.publishedAt,
          latestVersion: compatible.update.version,
          latestSha: compatible.update.sha,
          hasUpdate: true,
        },
        blockedBy: null,
      }
    }),
  )

  let blockedByAge: ActionUpdate[] = []
  let blockedByMode: ActionUpdate[] = []
  let eligible: ActionUpdate[] = []

  for (let decision of decisions) {
    if (decision.blockedBy === 'age') {
      blockedByAge.push(decision.update)
    } else if (decision.blockedBy === 'mode') {
      blockedByMode.push(decision.update)
    } else {
      eligible.push(decision.update)
    }
  }

  /**
   * Deduplicate resolution per action and version, so repeated occurrences
   * across files share one resolution.
   */
  let resolutionCache = new Map<string, Promise<ActionUpdate>>()
  outdated = await Promise.all(
    eligible.map(async update => {
      let resolutionKey = [
        update.action.name,
        update.currentVersion,
        update.latestVersion,
        update.latestSha,
      ].join('@')
      let resolution = resolutionCache.get(resolutionKey)
      if (!resolution) {
        resolution = resolveTargetReference(update, {
          client: githubClient,
          style,
          mode,
        })
        resolutionCache.set(resolutionKey, resolution)
      }
      let resolved = await resolution
      return {
        ...update,
        targetRefRateLimited: resolved.targetRefRateLimited,
        targetRefStyle: resolved.targetRefStyle,
        targetRef: resolved.targetRef,
      }
    }),
  )

  /**
   * Drop no-op updates whose resolved target matches the current reference.
   */
  outdated = outdated.filter(
    update => update.targetRef !== update.action.version,
  )
  let unresolvedByStyle = outdated
    .filter(update => !update.targetRef)
    .map(update => ({
      ...update,
      skipReason: 'unsupported-style' as const,
      status: 'skipped' as const,
      hasUpdate: false,
    }))
  skipped.push(...unresolvedByStyle)
  outdated = outdated.filter(update => update.targetRef)

  /**
   * Runners join once every ref-specific stage is done, so they reach the
   * preview, the prompt and the writer exactly like an action update.
   *
   * Moving a job to a newer image is a major-level change by nature, so a
   * narrowed update mode holds runners back and reports them the same way it
   * reports a held-back major action bump.
   */
  let runners: ActionUpdate[] = []
  if (mode === 'major') {
    runners = filteredRunners
  } else {
    blockedByMode.push(...filteredRunners)
  }

  return {
    status:
      outdated.length > 0 || runners.length > 0 ?
        'updates-available'
      : 'up-to-date',
    actionsChecked: actionsToCheck.length,
    blockedAsDowngrade,
    updates: outdated,
    blockedByMode,
    blockedByAge,
    skipped,
    runners,
  }
}

/**
 * Drops the entries whose line carries an ignore comment. The line of a value
 * written below its key counts as well. The comments are read in parallel, and
 * the kept entries stay in the given order.
 *
 * @param updates - Entries to check.
 * @returns Entries without an ignore comment, in the given order.
 */
async function dropIgnoredUpdates(
  updates: ActionUpdate[],
): Promise<ActionUpdate[]> {
  let checked = await Promise.all(
    updates.map(async update => {
      let { valueLine, file, line } = update.action
      let ignored =
        (await shouldIgnore(file, line)) ||
        (valueLine !== undefined && (await shouldIgnore(file, valueLine)))
      return { ignored, update }
    }),
  )
  return checked.filter(({ ignored }) => !ignored).map(({ update }) => update)
}

/**
 * Create a plan that holds no entries at all.
 *
 * @param status - Why the plan holds nothing.
 * @returns Plan with empty lists.
 */
function createEmptyPlan(status: UpdatePlanStatus): UpdatePlan {
  return {
    blockedAsDowngrade: [],
    actionsChecked: 0,
    blockedByMode: [],
    blockedByAge: [],
    skipped: [],
    updates: [],
    runners: [],
    status,
  }
}
