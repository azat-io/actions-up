import { parseTagFamily } from './parse-tag-family'

/**
 * Check whether two tag references may be compared as versions of the same
 * artifact.
 *
 * A repository can publish several disjoint tag families at once — npm releases
 * under `v<x.y.z>` and an action under `actions-v<x.y.z>`, for example — and a
 * candidate from the wrong family resolves to an existing but unrelated
 * commit.
 *
 * A single trailing `v` is stripped from both prefixes before they are
 * compared, so `v1.2.3` and `1.2.3` belong to one family and a publisher adding
 * a `v` mid-history does not strand anyone.
 *
 * References whose family cannot be determined (branches, SHA pins,
 * four-segment versions) are reported as compatible: the check exists to block
 * known mismatches, not to reject everything it does not recognize.
 *
 * Examples:
 *
 * - `actions-v0.1.1` + `actions-v0.2.0` -> true
 * - `actions-v0.1.1` + `v0.2.3` -> false
 * - `v1.0.0` + `1.1.0` -> true
 * - `v1` + `nightly` -> true.
 *
 * @param currentVersion - Reference currently used in the workflow.
 * @param candidateVersion - Reference an update would write.
 * @returns True when the two references may be compared.
 */
export function isSameTagFamily(
  currentVersion: undefined | string | null,
  candidateVersion: undefined | string | null,
): boolean {
  let current = parseTagFamily(currentVersion)
  let candidate = parseTagFamily(candidateVersion)

  if (!current || !candidate) {
    return true
  }

  return (
    normalizeFamilyPrefix(current.prefix) ===
    normalizeFamilyPrefix(candidate.prefix)
  )
}

/**
 * Drop a single trailing `v` so that `v` and `actions-v` compare equal to their
 * unprefixed counterparts.
 *
 * @param prefix - Literal prefix of a parsed tag family.
 * @returns Prefix without its trailing version marker.
 */
function normalizeFamilyPrefix(prefix: string): string {
  return prefix.replace(/v$/iu, '')
}
