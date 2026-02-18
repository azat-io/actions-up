import semver from 'semver'

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

  let current = normalizeVersion(currentVersion)
  let latest = normalizeVersion(latestVersion)

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

/**
 * Normalize a version string to semver, if possible.
 *
 * @param version - Version string to normalize.
 * @returns Normalized semver string or null if not coercible.
 */
function normalizeVersion(version: string): string | null {
  let coerced = semver.coerce(version)
  if (!coerced) {
    return null
  }

  return coerced.version
}
