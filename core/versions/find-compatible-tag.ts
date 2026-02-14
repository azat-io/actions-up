import semver from 'semver'

import type { UpdateMode } from '../../types/update-mode'
import type { TagInfo } from '../../types/tag-info'

import { normalizeVersion } from './normalize-version'
import { isSemverLike } from './is-semver-like'

/**
 * Pick the newest compatible tag for the provided update mode.
 *
 * Compatibility rules:
 *
 * - `minor`: same major, greater than current.
 * - `patch`: same major and minor, greater than current.
 *
 * @param tags - Available tags from GitHub API.
 * @param currentVersion - Current action version.
 * @param mode - Mode that limits the allowed update level.
 * @returns Best compatible tag or null when no compatible candidate exists.
 */
export function findCompatibleTag(
  tags: TagInfo[],
  currentVersion: string | null,
  mode: Exclude<UpdateMode, 'major'>,
): TagInfo | null {
  if (!currentVersion || !isSemverLike(currentVersion) || tags.length === 0) {
    return null
  }

  let currentSemver = semver.valid(normalizeVersion(currentVersion))
  if (!currentSemver) {
    return null
  }

  let currentMajor = semver.major(currentSemver)
  let currentMinor = semver.minor(currentSemver)
  let candidates: { parsed: string; tag: TagInfo }[] = []

  for (let tagInfo of tags) {
    if (!isSemverLike(tagInfo.tag)) {
      continue
    }

    let parsed = semver.valid(normalizeVersion(tagInfo.tag))
    if (!parsed) {
      continue
    }

    if (!semver.gt(parsed, currentSemver)) {
      continue
    }

    if (semver.major(parsed) !== currentMajor) {
      continue
    }

    if (mode === 'patch' && semver.minor(parsed) !== currentMinor) {
      continue
    }

    candidates.push({ tag: tagInfo, parsed })
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => {
    let cmp = semver.rcompare(a.parsed, b.parsed)
    if (cmp !== 0) {
      return cmp
    }
    let aSpecific = getSemverSpecificity(a.tag.tag)
    let bSpecific = getSemverSpecificity(b.tag.tag)
    return bSpecific - aSpecific
  })

  return candidates[0]!.tag
}

/**
 * Compute semver specificity by counting numeric parts.
 *
 * @param value - Semver-like tag.
 * @returns Number of numeric parts (1 for `v1`, 2 for `v1.2`, 3 for `v1.2.3`).
 */
function getSemverSpecificity(value: string): number {
  return value.replace(/^v/u, '').split('.').length
}
