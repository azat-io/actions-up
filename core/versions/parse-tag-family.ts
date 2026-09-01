import semver from 'semver'

import type { TagFamily } from '../../types/tag-family'

import { isSha } from './is-sha'

/**
 * Splits a tag into the literal text preceding its numeric core, the core
 * itself and an optional semver qualifier.
 *
 * The prefix can never end with a digit or a dot, which is what keeps the
 * boundary between `actions-v` and `0.1.1` unambiguous and rejects four-segment
 * versions such as `1.2.3.4`.
 */
const TAG_FAMILY_PATTERN =
  /^(?<prefix>(?:.*[^\d.])?)(?<core>\d+(?:\.\d+){0,2})(?<qualifier>[+-][\w+\-.]*)?$/u

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

  let match = TAG_FAMILY_PATTERN.exec(value)

  if (!match?.groups) {
    return null
  }

  /**
   * The prefix group always participates in a successful match, matching an
   * empty string for unprefixed tags, so it never needs a fallback. The
   * qualifier group is optional as a whole and stays undefined when absent.
   */
  let prefix = match.groups['prefix']!
  let core = match.groups['core']!
  let qualifier = match.groups['qualifier'] ?? ''

  let segments = core.split('.')
  let padded = [...segments, '0', '0'].slice(0, 3).join('.')
  let version = semver.valid(`${padded}${qualifier}`)

  if (!version) {
    return null
  }

  return {
    specificity: segments.length,
    qualifier,
    version,
    prefix,
    core,
  }
}
