import semver from 'semver'

import type { TagInfo } from '../../types/tag-info'

import { normalizeVersion } from './normalize-version'
import { isSemverLike } from './is-semver-like'

/**
 * Pick the highest semver-like tag among the repository tags.
 *
 * A tag qualifies only when it both looks like a version and yields a
 * comparable semver. The two conditions are not the same: `isSemverLike`
 * accepts any run of digits, while `normalizeVersion` hands back SHA-shaped
 * values untouched, so a tag such as `20240101` passes the first check and
 * carries no version at all. Such tags are dropped rather than compared,
 * because semver throws on them.
 *
 * Among equal versions the more specific tag wins, so `v6.2.3` is preferred
 * over the floating `v6` that resolves to the same version.
 *
 * Examples:
 *
 * - `['v1.2.3', 'v1.2.4']` -> `v1.2.4`
 * - `['v6', 'v6.0.0']` -> `v6.0.0`
 * - `['v1.2.3', '20240101']` -> `v1.2.3`
 * - `['20240101']` -> null.
 *
 * @param tags - Tags available in the action repository.
 * @returns Newest tag with its comparable version, or null when none carries
 *   one.
 */
export function selectLatestSemverTag(
  tags: TagInfo[],
): { version: string; tag: TagInfo } | null {
  let candidates: { version: string; tag: TagInfo }[] = []

  for (let tagInfo of tags) {
    if (!isSemverLike(tagInfo.tag)) {
      continue
    }

    let version = semver.valid(normalizeVersion(tagInfo.tag))

    if (!version) {
      continue
    }

    candidates.push({ tag: tagInfo, version })
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((first, second) => {
    let comparison = semver.rcompare(first.version, second.version)

    if (comparison !== 0) {
      return comparison
    }

    return countSpecificity(second.tag.tag) - countSpecificity(first.tag.tag)
  })

  return candidates[0]!
}

/**
 * Rank a tag by how precisely it names a version.
 *
 * @param tag - Tag name to inspect.
 * @returns 1 when the tag carries more than a bare major, 0 otherwise.
 */
function countSpecificity(tag: string): number {
  return /\d+\.\d+/u.test(tag) ? 1 : 0
}
