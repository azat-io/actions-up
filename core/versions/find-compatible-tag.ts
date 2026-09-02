import semver from 'semver'

import type { UpdateMode } from '../../types/update-mode'
import type { TagInfo } from '../../types/tag-info'

import { isSameTagFamily } from './is-same-tag-family'
import { parseTagFamily } from './parse-tag-family'

/**
 * Pick the newest compatible tag for the provided update mode.
 *
 * Compatibility rules:
 *
 * - `minor`: same major, greater than current.
 * - `patch`: same major and minor, greater than current.
 *
 * Only tags from the current reference's own tag family are considered.
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
  let current = parseTagFamily(currentVersion)

  if (!current || tags.length === 0) {
    return null
  }

  let currentMajor = semver.major(current.version)
  let currentMinor = semver.minor(current.version)
  let candidates: { parsed: string; tag: TagInfo }[] = []

  for (let tagInfo of tags) {
    let family = parseTagFamily(tagInfo.tag)

    if (!family || !isSameTagFamily(currentVersion, tagInfo.tag)) {
      continue
    }

    if (!semver.gt(family.version, current.version)) {
      continue
    }

    if (semver.major(family.version) !== currentMajor) {
      continue
    }

    if (mode === 'patch' && semver.minor(family.version) !== currentMinor) {
      continue
    }

    candidates.push({ parsed: family.version, tag: tagInfo })
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => {
    let cmp = semver.rcompare(a.parsed, b.parsed)
    if (cmp !== 0) {
      return cmp
    }
    let aSpecific = parseTagFamily(a.tag.tag)!.specificity
    let bSpecific = parseTagFamily(b.tag.tag)!.specificity
    return bSpecific - aSpecific
  })

  return candidates[0]!.tag
}
