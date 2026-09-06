import semver from 'semver'

import type { UpdateMode } from '../../types/update-mode'
import type { TagInfo } from '../../types/tag-info'

import { isSameTagFamily } from './is-same-tag-family'
import { parseTagFamily } from './parse-tag-family'

/**
 * Rank the compatible tags for the provided update mode, newest first.
 *
 * Compatibility rules:
 *
 * - `major`: greater than current.
 * - `minor`: same major, greater than current.
 * - `patch`: same major and minor, greater than current.
 *
 * Only tags from the current reference's own tag family are considered.
 *
 * Prerelease members are ignored unless the current version is itself a
 * prerelease, so a step-down never lands on the release candidate that a stable
 * release was cut from.
 *
 * A caller that needs one answer takes the first entry. A caller that applies a
 * further constraint, such as the release age cool-down, walks the list until
 * an entry satisfies it.
 *
 * @param tags - Available tags from GitHub API.
 * @param currentVersion - Current action version.
 * @param parameters - Constraints applied to the ranking.
 * @param parameters.latestVersion - Newest version the caller already vetted.
 *   Tags above it are ignored, so the walk cannot offer a tag that was never
 *   released. Omit it, or pass a version that carries no comparable core, to
 *   rank every compatible tag.
 * @param parameters.mode - Mode that limits the allowed update level.
 * @returns Compatible tags ordered newest first, empty when none qualify.
 */
export function findCompatibleTags(
  tags: TagInfo[],
  currentVersion: string | null,
  parameters: { latestVersion?: string | null; mode: UpdateMode },
): TagInfo[] {
  let { latestVersion, mode } = parameters
  let current = parseTagFamily(currentVersion)

  if (!current || tags.length === 0) {
    return []
  }

  let ceiling = parseTagFamily(latestVersion)?.version ?? null
  let allowPrerelease = semver.prerelease(current.version) !== null
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

    if (!allowPrerelease && semver.prerelease(family.version) !== null) {
      continue
    }

    if (ceiling && semver.gt(family.version, ceiling)) {
      continue
    }

    if (mode !== 'major' && semver.major(family.version) !== currentMajor) {
      continue
    }

    if (mode === 'patch' && semver.minor(family.version) !== currentMinor) {
      continue
    }

    candidates.push({ parsed: family.version, tag: tagInfo })
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

  return candidates.map(candidate => candidate.tag)
}
