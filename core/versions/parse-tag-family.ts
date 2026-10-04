import semver from 'semver'

import type { TagFamily } from '../../types/tag-family'

import { isSha } from './is-sha'

/**
 * The numeric core of a tag and the optional semver qualifier that ends it.
 */
const VERSION_PATTERN =
  /^(?<core>\d+(?:\.\d+){0,2})(?<qualifier>[+-][\w+\-.]*)?$/u

/**
 * Parse a tag name into its family and version parts.
 *
 * Prerelease and build metadata belong to the version rather than to the
 * family, so `v1.2.3-rc.1` and `v1.2.3` share the `v` family.
 *
 * Returns null when the tag carries no comparable version: references without
 * digits (`main`, `nightly`), SHA references, four-segment versions (`1.2.3.4`)
 * and cores semver cannot represent (`v01.02.03`). Callers treat a null family
 * as "no opinion" rather than as a mismatch.
 *
 * Examples:
 *
 * - `actions-v0.1.1` -> prefix `actions-v`, core `0.1.1`, version `0.1.1`
 * - `v1` -> prefix `v`, core `1`, version `1.0.0`
 * - `@scope/pkg@0.2.3` -> prefix `@scope/pkg@`, core `0.2.3`
 * - `nightly` -> null.
 *
 * @param tag - Tag name to parse.
 * @returns Parsed tag family, or null when the tag carries no version.
 */
export function parseTagFamily(
  tag: undefined | string | null,
): TagFamily | null {
  if (!tag) {
    return null
  }

  let value = tag.trim()

  if (value === '' || isSha(value)) {
    return null
  }

  /**
   * A core starts at a digit that follows neither a digit nor a dot, so the
   * prefix never ends with one; that keeps `actions-v` apart from `0.1.1` and
   * rejects four-segment versions such as `1.2.3.4`. Several starts can still
   * leave a valid version: `v1.2.3-rc1` reads as `v` with `1.2.3-rc1` or as
   * `v1.2.3-rc` with `1`. The reading with the most specific core wins, which
   * keeps a glued prerelease such as `rc1` on the version while digits in a
   * family name (`node20-v1.2.3`) stay in the prefix. A tie keeps the longer
   * prefix.
   */
  let family: TagFamily | null = null

  for (let start = 0; start < value.length; start++) {
    let candidate = readFamilyAt(value, start)

    if (candidate && (!family || candidate.specificity >= family.specificity)) {
      family = candidate
    }
  }

  return family
}

/**
 * Read the tag as a prefix ending right before `start` followed by a version.
 *
 * @param value - Trimmed tag name.
 * @param start - Index where the numeric core would begin.
 * @returns Parsed tag family, or null when no version starts there.
 */
function readFamilyAt(value: string, start: number): TagFamily | null {
  let previous = value[start - 1]

  if (previous !== undefined && /[\d.]/u.test(previous)) {
    return null
  }

  let match = VERSION_PATTERN.exec(value.slice(start))

  if (!match?.groups) {
    return null
  }

  /**
   * The qualifier group is optional as a whole and stays undefined when absent.
   */
  let core = match.groups['core']!
  let qualifier = match.groups['qualifier'] ?? ''

  let segments = core.split('.')
  let padded = [...segments, '0', '0'].slice(0, 3).join('.')
  let version = semver.valid(`${padded}${qualifier}`)

  if (!version) {
    return null
  }

  return {
    prefix: value.slice(0, start),
    specificity: segments.length,
    qualifier,
    version,
    core,
  }
}
