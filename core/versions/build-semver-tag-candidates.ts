import type { UpdateMode } from '../../types/update-mode'

import { isSemverLike } from './is-semver-like'

/**
 * Build canonical floating tag candidates for the latest version based on the
 * update mode:
 *
 * - `patch`: prefer `v<major>.<minor>`, then `v<major>`
 * - `minor` and `major`: prefer `v<major>`.
 *
 * The full latest version is excluded because it always exists and serves as
 * the final fallback.
 *
 * Examples:
 *
 * - `v6.2.3` + `patch` -> `['v6.2', 'v6']`
 * - `v6.2.3` + `major` -> `['v6']`
 * - `v6.2` + `patch` -> `[]`
 * - `v6` + `major` -> `[]`.
 *
 * @param latestVersion - Latest resolved tag reference.
 * @param mode - Update mode selected for the current run.
 * @returns Floating tag candidates, or an empty array when none apply.
 */
export function buildSemverTagCandidates(
  latestVersion: undefined | string | null,
  mode: UpdateMode,
): string[] {
  if (!latestVersion) {
    return []
  }

  let latest = latestVersion.trim()

  if (!isSemverLike(latest)) {
    return []
  }

  let prefix = latest.startsWith('v') ? 'v' : ''
  let latestParts = latest.replace(/^v/u, '').split('.')
  let preferredLength = mode === 'patch' ? 2 : 1

  /**
   * When the latest tag is already at or below the preferred granularity, it is
   * the canonical form itself and no floating candidates are needed.
   */
  if (latestParts.length <= preferredLength) {
    return []
  }

  let candidates: string[] = []

  for (let length = preferredLength; length >= 1; length--) {
    candidates.push(`${prefix}${latestParts.slice(0, length).join('.')}`)
  }

  return candidates
}
