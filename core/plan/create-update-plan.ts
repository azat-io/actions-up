import type {
  CompatibleUpdate,
  HeldCandidate,
} from '../api/get-compatible-update'
import type { CandidateAssessment } from '../../types/candidate-assessment'
import type { UpdatePlanStatus, UpdatePlan } from '../../types/update-plan'
import type { ActionUpdate } from '../../types/action-update'
import type { UpdateStyle } from '../../types/update-style'
import type { HoldReason } from '../../types/hold-reason'
import type { ScanResult } from '../../types/scan-result'
import type { UpdateMode } from '../../types/update-mode'
import type { TrustHold } from '../../types/trust-hold'

import { resolveTargetReference } from '../updates/resolve-target-reference'
import { parseVersionComment } from '../versions/parse-version-comment'
import { filterDowngradeUpdates } from './filter-downgrade-updates'
import { matchesAnyPattern } from '../filters/matches-any-pattern'
import { getCompatibleUpdate } from '../api/get-compatible-update'
import { createGitHubClient } from '../api/create-github-client'
import { getRunnerUpdate } from '../runners/get-runner-update'
import { parseTagFamily } from '../versions/parse-tag-family'
import { getUpdateLevel } from '../versions/get-update-level'
import { assessCandidate } from '../trust/assess-candidate'
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
 * Where the decision on an outdated update puts it.
 */
interface Decision {
  /**
   * List the update lands in: written, held back by the update mode, the
   * cool-down or a trust check, or skipped because a check could not run.
   */
  kind: 'eligible' | 'skipped' | 'trust' | 'mode' | 'age'

  /**
   * For an update that stepped down past versions whose commit failed a trust
   * check, the same update held back for that reason. It takes the place of the
   * update when the older version turns out to change nothing.
   */
  heldForTrust?: ActionUpdate

  /**
   * The update, carrying what the decision learned about it.
   */
  update: ActionUpdate
}

/**
 * Milliseconds in a day, the unit of `minAge`.
 */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Plan the updates of the scanned entries: check them against GitHub, apply the
 * ignore comments, the downgrade guard, the update mode, the cool-down, the
 * trust checks and the update style, and sort every entry into what can be
 * written and what was left out.
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
  let { blocked, kept } = filterDowngradeUpdates(outdated)
  let blockedAsDowngrade = blocked.map(update =>
    holdUpdate(update, { holdReason: 'downgrade' }),
  )
  outdated = kept

  /**
   * Resolve the update mode, the release age cool-down and the trust checks
   * together. Every version an update would write goes through
   * `assessCandidate`. An action held back by the mode, the cool-down or a
   * trust check steps down to the newest release that passes them all, and is
   * reported as held back only when no release does. Actions matched by
   * `--min-age-exclude` skip the cool-down but still follow the update mode,
   * and no action skips the trust checks.
   */
  let minAgeMs = options.minAge * DAY_MS
  let now = Date.now()

  /**
   * Deduplicate the assessment of the latest version per repository, tag and
   * commit, so an action used by many workflows, or several actions of one
   * repository, share it. Whether the cool-down applies is part of the key,
   * because the exemption depends on the action name.
   */
  let assessmentCache = new Map<string, Promise<CandidateAssessment>>()

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
    outdated.map(async (update): Promise<Decision> => {
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
      let cooldown = !isAgeExempt && minAgeMs > 0 ? { minAgeMs, now } : null

      /**
       * An outdated entry always has a latest version, and the update check
       * finds one only for an `owner/repo` name.
       */
      let latestVersion = update.latestVersion!
      let [owner, repository] = update.action.name.split('/') as [
        string,
        string,
      ]

      /**
       * A SHA pin whose version comment names the latest tag records the commit
       * that tag pointed at when the pin was written, so the assessment can
       * tell whether the tag moved since.
       */
      let pinnedVersion = parseVersionComment(update.action.comment)
      let pinnedSha =
        (
          pinnedVersion === latestVersion &&
          isSha(update.currentVersion) &&
          parseTagFamily(pinnedVersion)?.specificity === 3
        ) ?
          update.currentVersion
        : null

      /**
       * The latest version is assessed only when the mode would let it be
       * written. A verdict that could not be established ends the decision
       * here: nothing is known against the version, so stepping down would
       * offer an older one for no reason.
       */
      let latestAssessment: CandidateAssessment | null = null
      if (allowedByMode) {
        let assessmentKey = [
          owner,
          repository,
          latestVersion,
          update.latestSha,
          pinnedSha,
          cooldown ? 'cool-down' : 'no-cool-down',
        ].join('@')
        let pendingAssessment = assessmentCache.get(assessmentKey)
        if (!pendingAssessment) {
          pendingAssessment = assessCandidate(githubClient, {
            release:
              update.publishedAt ?
                {
                  immutable: update.immutableRelease === true,
                  publishedAt: update.publishedAt,
                }
              : undefined,
            sha: update.latestSha,
            tag: latestVersion,
            repo: repository,
            pinnedSha,
            cooldown,
            owner,
          })
          assessmentCache.set(assessmentKey, pendingAssessment)
        }
        latestAssessment = await pendingAssessment

        if (!latestAssessment.reason) {
          return {
            update: applyCandidate(update, {
              assessment: latestAssessment,
              version: latestVersion,
              trustHolds: [],
            }),
            kind: 'eligible',
          }
        }

        if (
          ['reachability-unknown', 'sha-unresolved', 'no-commit'].includes(
            latestAssessment.reason,
          )
        ) {
          return {
            update: skipUpdate(
              update,
              latestAssessment.reason === 'reachability-unknown' ?
                'reachability-unknown'
              : 'sha-unresolved',
            ),
            kind: 'skipped',
          }
        }

        if (latestAssessment.reason === 'age-unknown') {
          return {
            update: holdUpdate(update, {
              assessment: latestAssessment,
              holdReason: 'age-unknown',
            }),
            kind: 'age',
          }
        }
      }

      let latestHold: HeldCandidate | null =
        latestAssessment?.reason ?
          {
            reason: latestAssessment.reason,
            sha: latestAssessment.sha,
            version: latestVersion,
          }
        : null

      let compatibleKey = [
        update.action.name,
        effectiveCurrentVersion,
        latestVersion,
      ].join('@')
      let pendingWalk = compatibleCache.get(compatibleKey)
      if (!pendingWalk) {
        pendingWalk = getCompatibleUpdate(githubClient, {
          currentVersion: effectiveCurrentVersion,
          held: latestHold ? [latestHold] : [],
          actionName: update.action.name,
          latestVersion,
          cooldown,
          mode,
        })
        compatibleCache.set(compatibleKey, pendingWalk)
      }
      let compatible = await pendingWalk

      let held = latestHold ? [latestHold, ...compatible.held] : compatible.held
      let trustHolds = collectTrustHolds(held)

      if (compatible.selected) {
        return {
          update: {
            ...applyCandidate(update, { ...compatible.selected, trustHolds }),
            isBreaking:
              getUpdateLevel(
                effectiveCurrentVersion,
                compatible.selected.version,
              ) === 'major',
          },
          heldForTrust:
            trustHolds.length > 0 ?
              holdUpdate(update, {
                holdReason: trustHolds[0]!.reason,
                assessment: latestAssessment,
                trustHolds,
              })
            : undefined,
          kind: 'eligible',
        }
      }

      return decideHeldUpdate(update, {
        assessment: latestAssessment,
        walkHeld: compatible.held,
        latestHold,
        trustHolds,
      })
    }),
  )

  let blockedByTrust: ActionUpdate[] = []
  let blockedByAge: ActionUpdate[] = []
  let blockedByMode: ActionUpdate[] = []
  let eligible: Decision[] = []

  let lists: Record<Exclude<Decision['kind'], 'eligible'>, ActionUpdate[]> = {
    trust: blockedByTrust,
    mode: blockedByMode,
    age: blockedByAge,
    skipped,
  }

  for (let decision of decisions) {
    if (decision.kind === 'eligible') {
      eligible.push(decision)
    } else {
      lists[decision.kind].push(decision.update)
    }
  }

  /**
   * Deduplicate resolution per action and version, so repeated occurrences
   * across files share one resolution.
   */
  let resolutionCache = new Map<string, Promise<ActionUpdate>>()
  let resolvedDecisions = await Promise.all(
    eligible.map(async ({ heldForTrust, update }) => {
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
        update: {
          ...update,
          targetRefRateLimited: resolved.targetRefRateLimited,
          targetRefStyle: resolved.targetRefStyle,
          targetRef: resolved.targetRef,
        },
        heldForTrust,
      }
    }),
  )

  /**
   * An update whose resolved target matches the current reference is a no-op
   * and is dropped, and one whose target the style cannot express is skipped.
   * An update that stepped down past a version whose commit failed a trust
   * check is reported as held back for it instead: the newest version is what
   * the run was asked about, and the finding must not vanish with the no-op.
   */
  outdated = []
  for (let { heldForTrust, update } of resolvedDecisions) {
    if (update.targetRef && update.targetRef !== update.action.version) {
      outdated.push(update)
    } else if (heldForTrust) {
      blockedByTrust.push(heldForTrust)
    } else if (!update.targetRef) {
      skipped.push({
        ...update,
        skipReason: 'unsupported-style',
        status: 'skipped',
        hasUpdate: false,
      })
    }
  }

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
    blockedByMode.push(
      ...filteredRunners.map(runner =>
        holdUpdate(runner, { holdReason: 'mode' }),
      ),
    )
  }

  return {
    status:
      outdated.length > 0 || runners.length > 0 ?
        'updates-available'
      : 'up-to-date',
    actionsChecked: actionsToCheck.length,
    blockedAsDowngrade,
    updates: outdated,
    blockedByTrust,
    blockedByMode,
    blockedByAge,
    skipped,
    runners,
  }
}

/**
 * Decide where an update goes when neither its latest version nor any older one
 * it could step down to passed every check.
 *
 * A commit that failed a trust check outranks everything else, since it means
 * the repository needs a look before any version of it is taken. Then the
 * cool-down of the latest version, then a check of an older version that could
 * not run, then the cool-down of the older versions. Only an update none of
 * that held back was held back by the mode alone.
 *
 * @param update - Outdated update.
 * @param outcome - What the assessment of the latest version and the walk
 *   found.
 * @param outcome.assessment - Assessment of the latest version, null when the
 *   mode did not allow it.
 * @param outcome.latestHold - The latest version, when it was held back.
 * @param outcome.walkHeld - Older versions held back, newest first, ending with
 *   the one that stopped the walk.
 * @param outcome.trustHolds - Versions whose commit failed a trust check.
 * @returns The decision.
 */
function decideHeldUpdate(
  update: ActionUpdate,
  outcome: {
    assessment: CandidateAssessment | null
    latestHold: HeldCandidate | null
    walkHeld: HeldCandidate[]
    trustHolds: TrustHold[]
  },
): Decision {
  let { assessment, latestHold, trustHolds, walkHeld } = outcome

  if (trustHolds.length > 0) {
    return {
      update: holdUpdate(update, {
        holdReason: trustHolds[0]!.reason,
        assessment,
        trustHolds,
      }),
      kind: 'trust',
    }
  }

  if (latestHold) {
    return {
      update: holdUpdate(update, { holdReason: 'cool-down', assessment }),
      kind: 'age',
    }
  }

  let stop = walkHeld.at(-1)

  if (
    stop?.reason === 'sha-unresolved' ||
    stop?.reason === 'reachability-unknown'
  ) {
    return { update: skipUpdate(update, stop.reason), kind: 'skipped' }
  }

  if (stop) {
    return {
      update: holdUpdate(update, {
        holdReason: stop.reason === 'age-unknown' ? 'age-unknown' : 'cool-down',
      }),
      kind: 'age',
    }
  }

  return { update: holdUpdate(update, { holdReason: 'mode' }), kind: 'mode' }
}

/**
 * Mark an update as held back, with what was learned about its latest version.
 *
 * @param update - Update to hold back.
 * @param hold - Why, and what is known.
 * @param hold.holdReason - Why the update is held back.
 * @param hold.assessment - Assessment of the latest version, when it was
 *   assessed.
 * @param hold.trustHolds - Versions whose commit failed a trust check.
 * @returns The held-back update.
 */
function holdUpdate(
  update: ActionUpdate,
  hold: {
    assessment?: CandidateAssessment | null
    trustHolds?: TrustHold[]
    holdReason: HoldReason
  },
): ActionUpdate {
  let { assessment, trustHolds, holdReason } = hold
  let held: ActionUpdate = { ...update, holdReason }

  if (assessment) {
    held.immutableRelease = assessment.immutableRelease ?? undefined
    held.effectiveDate = assessment.effectiveDate
    held.publishedAt = assessment.publishedAt
    held.ageSource = assessment.ageSource
  }

  if (trustHolds) {
    held.trustHolds = trustHolds
  }

  return held
}

/**
 * Point an update at a version that passed every check, with what its
 * assessment learned about it.
 *
 * @param update - Outdated update.
 * @param candidate - The version and its assessment.
 * @param candidate.assessment - Assessment that let the version through.
 * @param candidate.version - Tag of the version.
 * @param candidate.trustHolds - Newer versions passed over because their commit
 *   failed a trust check.
 * @returns The update aimed at the version.
 */
function applyCandidate(
  update: ActionUpdate,
  candidate: {
    assessment: CandidateAssessment
    trustHolds: TrustHold[]
    version: string
  },
): ActionUpdate {
  let { assessment, trustHolds, version } = candidate

  return {
    ...update,
    immutableRelease: assessment.immutableRelease ?? undefined,
    effectiveDate: assessment.effectiveDate,
    publishedAt: assessment.publishedAt,
    ageSource: assessment.ageSource,
    latestSha: assessment.sha,
    latestVersion: version,
    hasUpdate: true,
    trustHolds,
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
 * Take the versions whose commit failed a trust check out of the held ones.
 *
 * @param held - Versions held back, newest first.
 * @returns The trust holds, newest first.
 */
function collectTrustHolds(held: HeldCandidate[]): TrustHold[] {
  let trustHolds: TrustHold[] = []

  for (let { version, reason, sha } of held) {
    if (sha && (reason === 'tag-moved' || reason === 'unreachable-commit')) {
      trustHolds.push({ version, reason, sha })
    }
  }

  return trustHolds
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
    blockedByTrust: [],
    actionsChecked: 0,
    blockedByMode: [],
    blockedByAge: [],
    skipped: [],
    updates: [],
    runners: [],
    status,
  }
}

/**
 * Mark an update as skipped because a check it needed could not run.
 *
 * @param update - Update to skip.
 * @param skipReason - Which check could not run.
 * @returns The skipped update.
 */
function skipUpdate(
  update: ActionUpdate,
  skipReason: 'reachability-unknown' | 'sha-unresolved',
): ActionUpdate {
  return { ...update, status: 'skipped', hasUpdate: false, skipReason }
}
