import semver from 'semver'
import pc from 'picocolors'

/**
 * Formats a version string for display, handling null/undefined values.
 *
 * @param latestVersion - Latest version string or null/undefined.
 * @param currentVersion - Current version string or null/undefined.
 * @returns Formatted version string or 'unknown' placeholder.
 */
export function formatVersion(
  latestVersion: undefined | string | null,
  currentVersion: undefined | string | null,
): string {
  if (!latestVersion) {
    return pc.gray('unknown')
  }

  let latest = semver.parse(latestVersion)
  let current =
    currentVersion ? semver.parse(normalizeVersion(currentVersion)) : null

  if (!current || !latest) {
    return latestVersion
  }

  let change = semver.diff(normalizeVersion(currentVersion!), latestVersion)
  let unstable = current.major === 0

  let changeColor = unstable ? pc.yellowBright : pc.gray

  let parts = [latest.major, latest.minor, latest.patch]
  let colors = parts.map((_, i) => {
    if (change === 'major') {
      return pc.redBright
    }
    if (change === 'minor' && i >= 1) {
      return changeColor
    }
    if (change === 'patch' && i === 2) {
      return changeColor
    }

    return identity
  })

  let result = colors[0]!(String(parts[0]))

  if (parts[1] !== undefined) {
    result += colors[0]!('.') + colors[1]!(String(parts[1]))
  }

  if (parts[2] !== undefined) {
    result += colors[1]!('.') + colors[2]!(String(parts[2]))
  }

  return result
}

/**
 * Normalizes a version string to semver format. Handles GitHub Actions style
 * versions like 'v1', 'v1.2', '2'.
 *
 * @param version - The version string to normalize.
 * @returns The normalized version string.
 */
function normalizeVersion(version: string): string {
  let cleaned = version.replace(/^v/u, '')

  let parts = cleaned.split('.')

  while (parts.length < 3) {
    parts.push('0')
  }

  return parts.slice(0, 3).join('.')
}

/**
 * Identity helper to avoid adding ANSI codes when no styling is needed.
 *
 * @param string - The input string.
 * @returns The unmodified input string.
 */
function identity(string: string): string {
  return string
}
