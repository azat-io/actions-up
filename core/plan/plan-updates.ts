import type { PlanUpdatesOptions } from '../../types/plan-updates-options'
import type { UpdatePlan } from '../../types/update-plan'

import { parseExcludePatterns } from '../filters/parse-exclude-patterns'
import { normalizeUpdateStyle } from './normalize-update-style'
import { normalizeUpdateMode } from './normalize-update-mode'
import { createUpdatePlan } from './create-update-plan'
import { scanRepository } from './scan-repository'

/**
 * Plan the updates of a repository the way the CLI does.
 *
 * The repository is scanned, every action is checked against GitHub, and the
 * same policy as in the CLI is applied: excludes, ignore comments, the
 * downgrade guard, the update mode, the release age cool-down and the update
 * style. Each option defaults to the default of the matching CLI flag.
 *
 * Nothing is written. Pass the planned `updates` and `runners`, or a selection
 * of them, to `applyUpdates` to write them.
 *
 * @example
 *
 * ```ts
 * import { applyUpdates, planUpdates } from 'actions-up'
 *
 * let plan = await planUpdates({ mode: 'minor', style: 'preserve' })
 * let unwritten = await applyUpdates([...plan.updates, ...plan.runners])
 * ```
 *
 * @param options - Where to look and which policy to apply.
 * @returns Updates that can be written and the entries left out, with the
 *   reason for each.
 * @throws Error - When an option holds an invalid value.
 * @throws Error - Named `GitHubRateLimitError` when GitHub refused a request
 *   because a rate limit was exhausted; its message says when the limit
 *   resets.
 */
export async function planUpdates(
  options: PlanUpdatesOptions = {},
): Promise<UpdatePlan> {
  let minAge = options.minAge ?? 1

  if (!Number.isFinite(minAge) || minAge < 0) {
    throw new Error(
      `Invalid minAge "${minAge}". Expected a non-negative number.`,
    )
  }

  let mode = normalizeUpdateMode(options.mode)
  let style = normalizeUpdateStyle(options.style)

  let { scanResult } = await scanRepository({
    cwd: options.cwd ?? process.cwd(),
    directories: options.directories,
    recursive: options.recursive,
  })

  return createUpdatePlan(scanResult, {
    minAgeExcludes: parseExcludePatterns(options.minAgeExclude ?? []),
    excludes: parseExcludePatterns(options.exclude ?? []),
    includeBranches: options.includeBranches ?? false,
    preferTags: options.preferTags ?? false,
    token: options.token,
    minAge,
    style,
    mode,
  })
}
