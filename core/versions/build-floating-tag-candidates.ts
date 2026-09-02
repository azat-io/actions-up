import { formatFamilyTag } from './format-family-tag'
import { parseTagFamily } from './parse-tag-family'

/**
 * Build floating tag candidates for the latest version, ordered from the
 * granularity of the current tag down to the broadest (major-only) form.
 *
 * The full latest version is excluded because it always exists and serves as
 * the final fallback.
 *
 * Examples:
 *
 * - `v6.1` + `v6.2.3` -> `['v6.2', 'v6']`
 * - `v7` + `v8.3.2` -> `['v8']`
 * - `actions-v0` + `actions-v0.1.2` -> `['actions-v0']`
 * - `v1.2.3` + `v2.0.1` -> `[]`.
 *
 * @param currentVersion - Current tag reference found in the workflow.
 * @param latestVersion - Latest resolved tag reference.
 * @returns Floating tag candidates, or an empty array when none apply.
 */
export function buildFloatingTagCandidates(
  currentVersion: undefined | string | null,
  latestVersion: undefined | string | null,
): string[] {
  let current = parseTagFamily(currentVersion)
  let latest = parseTagFamily(latestVersion)

  if (!current || !latest) {
    return []
  }

  /**
   * A prerelease or build qualifier is never carried by a floating tag.
   */
  if (current.qualifier !== '' || latest.qualifier !== '') {
    return []
  }

  /**
   * Compared literally rather than through `isSameTagFamily`, so that a tag
   * written without its `v` is never projected onto one written with it.
   */
  if (current.prefix !== latest.prefix) {
    return []
  }

  let latestSegments = latest.core.split('.')

  if (latestSegments.length <= current.specificity) {
    return []
  }

  let candidates: string[] = []

  for (let length = current.specificity; length >= 1; length--) {
    candidates.push(formatFamilyTag(latest, latestSegments.slice(0, length)))
  }

  return candidates
}
