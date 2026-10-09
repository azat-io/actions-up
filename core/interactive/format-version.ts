import semver from 'semver'

import { colors } from './colors'

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
    return colors.gray('unknown')
  }

  let latest = semver.parse(latestVersion)
  let current =
    currentVersion ? semver.parse(normalizeVersion(currentVersion)) : null

  if (!current || !latest) {
    return latestVersion
  }

  let change = semver.diff(normalizeVersion(currentVersion!), latestVersion)
  let unstable = current.major === 0

  let changeColor = colors[unstable ? 'yellowBright' : 'gray']

  let parts = [latest.major, latest.minor, latest.patch]
  let partColors = parts.map((_, i) => {
    if (change === 'major') {
      return colors.redBright
    }
    if (change === 'minor' && i >= 1) {
      return changeColor
    }
    if (change === 'patch' && i === 2) {
      return changeColor
    }

    return identity
  })

  return (
    partColors[0]!(String(parts[0])) +
    partColors[0]!('.') +
    partColors[1]!(String(parts[1])) +
    partColors[1]!('.') +
    partColors[2]!(String(parts[2]))
  )
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
