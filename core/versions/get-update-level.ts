import semver from 'semver'

import { coerceTagVersion } from './coerce-tag-version'

/**
 * Update level for a version change.
 */
type UpdateLevel = 'unknown' | 'major' | 'minor' | 'patch' | 'none'

/**
 * Determine the update level between two version strings.
 *
 * @param currentVersion - Current version string.
 * @param latestVersion - Latest version string.
 * @returns Update level for the change.
 */
export function getUpdateLevel(
  currentVersion: undefined | string | null,
  latestVersion: undefined | string | null,
): UpdateLevel {
  if (!currentVersion || !latestVersion) {
    return 'unknown'
  }

  let current = coerceTagVersion(currentVersion)
  let latest = coerceTagVersion(latestVersion)

  if (!current || !latest) {
    return 'unknown'
  }

  if (semver.eq(current, latest)) {
    return 'none'
  }

  let diff = semver.diff(current, latest)
  if (!diff) {
    return 'none'
  }

  switch (diff) {
    case 'premajor':
    case 'major':
      return 'major'
    case 'preminor':
    case 'minor':
      return 'minor'
    case 'prepatch':
    case 'patch':
      return 'patch'
    default:
      return 'unknown'
  }
}
