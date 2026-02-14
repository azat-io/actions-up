import semver from 'semver'

/**
 * Normalize version string.
 *
 * Rules:
 *
 * - Remove `v` prefix before semver coercion.
 * - Preserve SHA-like values as-is.
 * - Return coerced semver when possible.
 * - Return original value when coercion fails.
 *
 * @param version - Version string to normalize.
 * @returns Normalized version string or null if input is empty.
 */
export function normalizeVersion(
  version: undefined | string | null,
): string | null {
  if (!version) {
    return null
  }

  let normalized = version.replace(/^v/u, '')

  if (/^[0-9a-f]{7,40}$/iu.test(normalized)) {
    return version
  }

  let coerced = semver.coerce(normalized)
  if (coerced) {
    return coerced.version
  }

  return version
}
