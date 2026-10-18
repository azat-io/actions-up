import type {
  CandidateHoldReason,
  CandidateAssessment,
} from '../../types/candidate-assessment'
import type { GitHubClient } from '../../types/github-client'
import type { ReleaseInfo } from '../../types/release-info'
import type { Cooldown } from '../../types/cooldown'

import { compareSha } from '../versions/compare-sha'
import { traceCommit } from './trace-commit'

/**
 * Candidate tag to assess.
 */
interface AssessCandidateParameters {
  /**
   * Release of the tag when the caller already holds it, null when the caller
   * knows the tag has none. Omitted, it is looked up when the cool-down needs
   * it or the tag no longer points at the pin.
   */
  release?: Pick<ReleaseInfo, 'publishedAt' | 'immutable'> | null

  /**
   * Commit a workflow pins with a version comment that names this very tag.
   */
  pinnedSha?: string | null

  /**
   * Cool-down to apply, null when it does not apply to the action.
   */
  cooldown: Cooldown | null

  /**
   * Commit the tag points at, when a tag listing or an earlier lookup already
   * read it from the tag reference.
   */
  sha?: string | null

  /**
   * Repository owner.
   */
  owner: string

  /**
   * Repository name.
   */
  repo: string

  /**
   * Tag an update would name.
   */
  tag: string
}

/**
 * Decide whether a tag may be written as the update of an action.
 *
 * Every path that picks a version runs its candidate through here: the latest
 * release, the newest tag of a repository without releases or of a tag family,
 * a tag preferred over a release, and each step down to an older version. Two
 * questions are answered for the commit the tag points at now, each from data
 * GitHub computes and each allowed to stay open:
 *
 * - **Provenance**: does the default branch or a protected branch hold the
 *   commit? Asked whatever the cool-down.
 * - **Age**, with the cool-down on: has the commit been public for at least the
 *   cool-down? Either the tag has an immutable release that old, whose tag has
 *   pointed at this commit since it was published, or a branch that holds the
 *   commit already held it at the start of the cool-down and has kept it since,
 *   as the history GitHub records for that branch shows.
 *
 * Before either, a tag that a SHA pin names in its version comment must still
 * point at the pinned commit, whatever the cool-down: a tag moved away from a
 * pin is what a hijacked action looks like, however old the commit it points at
 * now.
 *
 * The dates written into a commit or a tag object are never evidence: whoever
 * moves a tag writes them too. The publication date of a mutable release is no
 * evidence either, since its tag can point at another commit by now; a release
 * that recent still holds the update back, because nothing proves the code it
 * names older. An answer that stays open holds the update back as well.
 *
 * A rate limit is never read as a failed check, because it hides the answer
 * instead of giving one.
 *
 * @param client - GitHub client instance.
 * @param parameters - Candidate tag and the cool-down to apply.
 * @returns The verdict, with what was learned about the candidate on the way.
 * @throws GitHubRateLimitError - When a request was rate limited.
 */
export async function assessCandidate(
  client: GitHubClient,
  parameters: AssessCandidateParameters,
): Promise<CandidateAssessment> {
  let { pinnedSha, cooldown, owner, repo, tag } = parameters
  let assessment: CandidateAssessment = {
    sha: parameters.sha ?? null,
    immutableRelease: null,
    effectiveDate: null,
    publishedAt: null,
    ageSource: null,
    reason: null,
  }

  if (!assessment.sha) {
    let resolved = await resolveTagSha(client, parameters)

    if (!resolved.sha) {
      return { ...assessment, reason: resolved.reason }
    }

    assessment.sha = resolved.sha
  }

  let { sha } = assessment
  let { release } = parameters
  let differsFromPin = Boolean(pinnedSha && !compareSha(pinnedSha, sha))

  /**
   * Only the release tells a moved tag from a pin written by hand, so it is
   * looked up for a pin the tag no longer points at even with the cool-down
   * off. A failed lookup leaves open the age the cool-down needs or, without
   * it, whether the tag was moved.
   */
  if (release === undefined && (cooldown || differsFromPin)) {
    try {
      release = await client.getReleaseByTag(owner, repo, tag)
    } catch (error) {
      rethrowRateLimit(error)
      return {
        ...assessment,
        reason: cooldown ? 'age-unknown' : 'release-unresolved',
      }
    }
  }

  if (release !== undefined) {
    assessment.immutableRelease = release?.immutable ?? false
    assessment.publishedAt = release?.publishedAt ?? null
  }

  /**
   * The version comment of a pin records the tag its commit came from, and the
   * tag of an immutable release cannot move, so another commit under such a tag
   * means a pin written by hand rather than a moved tag. A moved tag is told
   * apart before the age of its release, since a release can be recreated along
   * with the move.
   */
  if (differsFromPin && !release?.immutable) {
    return { ...assessment, reason: 'tag-moved' }
  }

  let agedSince: Date | null = null

  if (cooldown) {
    if (release && !release.publishedAt) {
      return { ...assessment, reason: 'age-unknown' }
    }

    if (
      release?.publishedAt &&
      cooldown.now - release.publishedAt.getTime() < cooldown.minAgeMs
    ) {
      return {
        ...assessment,
        effectiveDate: release.publishedAt,
        ageSource: 'release',
        reason: 'cool-down',
      }
    }

    agedSince = release?.immutable ? release.publishedAt : null
  }

  let cutoff =
    cooldown && !agedSince ? new Date(cooldown.now - cooldown.minAgeMs) : null
  let trace = await traceCommit(client, { cutoff, owner, repo, sha, tag })

  if (trace.inHistory !== 'yes') {
    return {
      ...assessment,
      reason:
        trace.inHistory === 'no' ?
          'unreachable-commit'
        : 'reachability-unknown',
    }
  }

  if (agedSince) {
    return { ...assessment, effectiveDate: agedSince, ageSource: 'release' }
  }

  if (!cutoff) {
    return assessment
  }

  if (trace.heldAtCutoff === 'yes') {
    return {
      ...assessment,
      effectiveDate: trace.heldSince ?? cutoff,
      ageSource: 'branch',
    }
  }

  return {
    ...assessment,
    reason: trace.heldAtCutoff === 'no' ? 'cool-down' : 'age-unknown',
  }
}

/**
 * Read the commit a tag points at from its tag reference.
 *
 * @param client - GitHub client instance.
 * @param parameters - Tag to resolve.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name.
 * @returns The commit, or why there is none: `no-commit` when GitHub answered
 *   that the tag points at no commit, `sha-unresolved` when the lookup failed.
 * @throws GitHubRateLimitError - When the request was rate limited.
 */
async function resolveTagSha(
  client: GitHubClient,
  parameters: { owner: string; repo: string; tag: string },
): Promise<
  | {
      reason: Extract<CandidateHoldReason, 'sha-unresolved' | 'no-commit'>
      sha: null
    }
  | { reason: null; sha: string }
> {
  let { owner, repo, tag } = parameters

  try {
    let sha = await client.getTagSha(owner, repo, tag)
    return sha ? { reason: null, sha } : { reason: 'no-commit', sha: null }
  } catch (error) {
    rethrowRateLimit(error)
    return { reason: 'sha-unresolved', sha: null }
  }
}

/**
 * Let a rate limit through to the caller.
 *
 * @param error - Error a lookup failed with.
 * @throws GitHubRateLimitError - When the lookup was rate limited.
 */
function rethrowRateLimit(error: unknown): void {
  if (error instanceof Error && error.name === 'GitHubRateLimitError') {
    throw error
  }
}
