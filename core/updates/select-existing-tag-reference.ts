import type { GitHubClient } from '../../types/github-client'

import { buildFloatingTagCandidates } from '../versions/build-floating-tag-candidates'
import { compareSha } from '../versions/compare-sha'

interface SelectExistingTagReferenceParameters {
  /**
   * Commit SHA of the latest version, when known.
   */
  latestSha: string | null

  /**
   * Current tag reference found in the workflow.
   */
  currentVersion: string

  /**
   * Latest resolved tag reference. Always exists in the action repository.
   */
  latestVersion: string

  /**
   * Action name in `owner/repo` format (path suffix is allowed).
   */
  actionName: string
}

interface SelectExistingTagReferenceResult {
  /**
   * True when rate limiting prevented validating floating tag candidates and
   * the exact latest version was used as a fallback.
   */
  rateLimited: boolean

  /**
   * Existing tag reference to write back to the workflow.
   */
  reference: string
}

/**
 * Select a tag reference that is guaranteed to exist in the action repository.
 *
 * Floating tag conventions are publisher-specific, so a reference derived by
 * reformatting the latest version may not exist (e.g. `v8` when only `v8.3.2`
 * is published). Candidates are probed from the granularity of the current
 * reference down to the major-only form; a candidate is accepted when its tag
 * exists and points at the latest release. When no candidate matches, the exact
 * latest version is returned as a safe fallback.
 *
 * @param client - GitHub client instance.
 * @param parameters - Lookup parameters.
 * @returns Selected tag reference and rate limit fallback flag.
 */
export async function selectExistingTagReference(
  client: GitHubClient,
  parameters: SelectExistingTagReferenceParameters,
): Promise<SelectExistingTagReferenceResult> {
  let { currentVersion, latestVersion, actionName, latestSha } = parameters

  let segments = actionName.split('/')
  let [owner, repo] = segments
  if (!owner || !repo) {
    return { reference: latestVersion, rateLimited: false }
  }

  let candidates = buildFloatingTagCandidates(currentVersion, latestVersion)

  /**
   * Resolve candidate SHAs upfront; a failed lookup makes the candidate
   * unusable instead of aborting the selection.
   */
  let probes = await Promise.all(
    candidates.map(async candidate => {
      try {
        let sha = await client.getTagSha(owner, repo, candidate)
        return { rateLimited: false, sha }
      } catch (error) {
        return { rateLimited: isRateLimitError(error), sha: null }
      }
    }),
  )

  let match = candidates.find((_candidate, index) => {
    let candidateSha = probes[index]!.sha
    if (!candidateSha) {
      return false
    }
    return !latestSha || compareSha(candidateSha, latestSha)
  })

  return {
    rateLimited: !match && probes.some(probe => probe.rateLimited),
    reference: match ?? latestVersion,
  }
}

function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && error.name === 'GitHubRateLimitError'
}
