import { formatFamilyTag } from './format-family-tag'
import { parseTagFamily } from './parse-tag-family'

/**
 * Preserve the semver granularity of the current tag when projecting a newer
 * tag reference.
 *
 * Examples:
 *
 * - `v6` + `v7.0.2` -> `v7`
 * - `v6.1` + `v6.2.3` -> `v6.2`
 * - `v6.1.4` + `v6.2.3` -> `v6.2.3`
 * - `actions-v0.1` + `actions-v0.2.3` -> `actions-v0.2`.
 *
 * Returns null when the target tag cannot be preserved safely.
 *
 * @param currentVersion - Current tag reference found in the workflow.
 * @param latestVersion - Latest resolved tag reference.
 * @returns Preserved tag reference or null when preservation is unsafe.
 */
export function preserveTagFormat(
  currentVersion: undefined | string | null,
  latestVersion: undefined | string | null,
): string | null {
  let current = parseTagFamily(currentVersion)
  let latest = parseTagFamily(latestVersion)

  if (!current || !latest) {
    return null
  }

  /**
   * Compared literally rather than through `isSameTagFamily`, so that a tag
   * written without its `v` is never projected onto one written with it.
   */
  if (current.prefix !== latest.prefix) {
    return null
  }

  let latestSegments = latest.core.split('.')

  if (latestSegments.length < current.specificity) {
    return null
  }

  return formatFamilyTag(current, latestSegments.slice(0, current.specificity))
}
