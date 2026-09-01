import semver from 'semver'

import type { TagFamily } from '../../types/tag-family'
import type { TagInfo } from '../../types/tag-info'

import { isSameTagFamily } from './is-same-tag-family'
import { parseTagFamily } from './parse-tag-family'

/**
 * Pick the newest tag belonging to the same family as the reference.
 *
 * Only members of the reference's own family are considered, so a repository
 * publishing several tag families at once cannot answer with the wrong one.
 * Prerelease members are ignored unless the reference is itself a prerelease,
 * and among equal versions the more specific tag wins so that `actions-v0.1.2`
 * is preferred over the floating `actions-v0`.
 *
 * The newest member is returned regardless of how it compares to the reference;
 * deciding whether that constitutes an update is the caller's job.
 *
 * @param tags - Tags available in the action repository.
 * @param reference - Reference currently used in the workflow.
 * @returns Newest tag of the reference's family, or null when there is none.
 */
export function selectLatestFamilyTag(
  tags: TagInfo[],
  reference: string,
): TagInfo | null {
  let referenceFamily = parseTagFamily(reference)

  if (!referenceFamily) {
    return null
  }

  let allowPrerelease = semver.prerelease(referenceFamily.version) !== null
  let candidates: { family: TagFamily; tag: TagInfo }[] = []

  for (let tagInfo of tags) {
    let family = parseTagFamily(tagInfo.tag)

    if (!family || !isSameTagFamily(reference, tagInfo.tag)) {
      continue
    }

    if (!allowPrerelease && semver.prerelease(family.version) !== null) {
      continue
    }

    candidates.push({ tag: tagInfo, family })
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((first, second) => {
    let comparison = semver.rcompare(
      first.family.version,
      second.family.version,
    )

    if (comparison !== 0) {
      return comparison
    }

    return second.family.specificity - first.family.specificity
  })

  return candidates[0]!.tag
}
