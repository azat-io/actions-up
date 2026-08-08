import { isSemverLike } from './is-semver-like'

/**
 * Build floating tag candidates for the latest version, ordered from the
 * granularity of the current tag down to the broadest (major-only) form.
 *
 * The full latest version is excluded because it always exists and serves as
 * the final fallback.
 *
 * Examples:
 *
 * - `v6.1` + `v6.2.3` -> `['v6.2', 'v6']`
 * - `v7` + `v8.3.2` -> `['v8']`
 * - `v1.2.3` + `v2.0.1` -> `[]`.
 *
 * @param currentVersion - Current tag reference found in the workflow.
 * @param latestVersion - Latest resolved tag reference.
 * @returns Floating tag candidates, or an empty array when none apply.
 */
export function buildFloatingTagCandidates(
  currentVersion: undefined | string | null,
  latestVersion: undefined | string | null,
): string[] {
  if (!currentVersion || !latestVersion) {
    return []
  }

  let current = currentVersion.trim()
  let latest = latestVersion.trim()

  if (!isSemverLike(current) || !isSemverLike(latest)) {
    return []
  }

  let currentHasVPrefix = current.startsWith('v')
  let latestHasVPrefix = latest.startsWith('v')

  if (currentHasVPrefix !== latestHasVPrefix) {
    return []
  }

  let currentParts = current.replace(/^v/u, '').split('.')
  let latestParts = latest.replace(/^v/u, '').split('.')

  if (latestParts.length <= currentParts.length) {
    return []
  }

  let prefix = currentHasVPrefix ? 'v' : ''
  let candidates: string[] = []

  for (let { length } = currentParts; length >= 1; length--) {
    candidates.push(`${prefix}${latestParts.slice(0, length).join('.')}`)
  }

  return candidates
}
