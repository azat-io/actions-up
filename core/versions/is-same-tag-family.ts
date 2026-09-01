import { getFamilyPrefix } from './get-family-prefix'

/**
 * Check whether two tag references may be compared as versions of the same
 * artifact.
 *
 * A repository can publish several disjoint tag families at once — npm releases
 * under `v<x.y.z>` and an action under `actions-v<x.y.z>`, for example — and a
 * candidate from the wrong family resolves to an existing but unrelated
 * commit.
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
  let current = getFamilyPrefix(currentVersion)
  let candidate = getFamilyPrefix(candidateVersion)

  if (current === null || candidate === null) {
    return true
  }

  return current === candidate
}
