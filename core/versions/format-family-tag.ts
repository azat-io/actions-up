import type { TagFamily } from '../../types/tag-family'

/**
 * Rebuild a tag name from a family and a numeric core.
 *
 * Used to project a resolved version back into the family it belongs to, so a
 * truncated reference stays inside its own namespace: the floating form of
 * `actions-v0.1.2` is `actions-v0`, never `v0`.
 *
 * Examples:
 *
 * - `actions-v` + `['0']` -> `actions-v0`
 * - `v` + `['7', '0']` -> `v7.0`
 * - `` + `['1', '2', '3']` -> `1.2.3`.
 *
 * @param family - Family the tag belongs to.
 * @param segments - Numeric segments of the version core.
 * @returns Tag name in the family's own format.
 */
export function formatFamilyTag(family: TagFamily, segments: string[]): string {
  return `${family.prefix}${segments.join('.')}`
}
