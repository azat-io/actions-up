import type { GitHubClient } from '../../types/github-client'

import { compareSha } from '../versions/compare-sha'

interface SelectExistingTagReferenceParameters {
  /**
   * Commit SHA of the latest version, when known.
   */
  latestSha: string | null

  /**
   * Latest resolved tag reference. Always exists in the action repository.
   */
  latestVersion: string

  /**
   * Floating tag candidates to probe, ordered from most to least preferred.
   */
  candidates: string[]

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
 * is published). Candidates are probed in the provided order; a candidate is
 * accepted when its tag exists and points at the latest release. When no
 * candidate matches, the exact latest version is returned as a safe fallback.
 *
 * @param client - GitHub client instance.
 * @param parameters - Lookup parameters.
 * @returns Selected tag reference and rate limit fallback flag.
 */
export async function selectExistingTagReference(
  client: GitHubClient,
  parameters: SelectExistingTagReferenceParameters,
): Promise<SelectExistingTagReferenceResult> {
  let { latestVersion, actionName, candidates, latestSha } = parameters

  let segments = actionName.split('/')
  let [owner, repo] = segments
  if (!owner || !repo) {
    return { reference: latestVersion, rateLimited: false }
  }

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
