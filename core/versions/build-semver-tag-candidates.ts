import type { UpdateMode } from '../../types/update-mode'

import { formatFamilyTag } from './format-family-tag'
import { parseTagFamily } from './parse-tag-family'

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
 * - `actions-v0.2.3` + `major` -> `['actions-v0']`
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
  let latest = parseTagFamily(latestVersion)

  /**
   * A prerelease or build qualifier is never carried by a floating tag.
   */
  if (latest?.qualifier !== '') {
    return []
  }

  let segments = latest.core.split('.')
  let preferredLength = mode === 'patch' ? 2 : 1

  /**
   * When the latest tag is already at or below the preferred granularity, it is
   * the canonical form itself and no floating candidates are needed.
   */
  if (segments.length <= preferredLength) {
    return []
  }

  let candidates: string[] = []

  for (let length = preferredLength; length >= 1; length--) {
    candidates.push(formatFamilyTag(latest, segments.slice(0, length)))
  }

  return candidates
}
