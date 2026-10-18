import type {
  CandidateHoldReason,
  CandidateAssessment,
} from '../../types/candidate-assessment'
import type { GitHubClient } from '../../types/github-client'
import type { UpdateMode } from '../../types/update-mode'
import type { Cooldown } from '../../types/cooldown'
import type { TagInfo } from '../../types/tag-info'

import { findCompatibleTags } from '../versions/find-compatible-tags'
import { getFamilyPrefix } from '../versions/get-family-prefix'
import { assessCandidate } from '../trust/assess-candidate'

/**
 * Most distinct commits outside the history of the repository the walk steps
 * past before it gives up on the repository.
 *
 * This is a policy, not a cost cap alone: tags of several versions pointing at
 * commits no trusted branch holds mean a compromised repository rather than a
 * mistake, as with the hijacked actions, which had dozens of tags moved, and no
 * version of such a repository is offered until someone has looked at it.
 */
const MAX_UNTRUSTED_COMMITS = 3

/**
 * Outcome of a compatible update lookup.
 */
export interface CompatibleUpdate {
  /**
   * Newest candidate that passed every check, null when none did.
   */
  selected: { assessment: CandidateAssessment; version: string } | null

  /**
   * Candidates the walk held back, newest first. A walk that stopped early ends
   * with the candidate that stopped it. A tag at a commit already found outside
   * the history of the repository is not repeated.
   */
  held: HeldCandidate[]
}

/**
 * Candidate tag held back, with the verdict that held it back.
 */
export interface HeldCandidate {
  /**
   * Why the candidate cannot be written.
   */
  reason: CandidateHoldReason

  /**
   * Commit the tag points at, null when it could not be resolved.
   */
  sha: string | null

  /**
   * Tag that was held back.
   */
  version: string
}

interface GetCompatibleUpdateParameters {
  /**
   * Newest version the caller already vetted, usually the release the update
   * check settled on. The walk never rises above it, so a tag that was never
   * released cannot be offered, and starts below it, since the caller already
   * assessed it. Omit it to consider every compatible tag.
   */
  latestVersion?: string | null

  /**
   * Current action version used as compatibility baseline.
   */
  currentVersion: string | null

  /**
   * Cool-down to apply, null when it does not apply to the action.
   */
  cooldown: Cooldown | null

  /**
   * Candidates the caller already held back. A tag that points at a commit one
   * of them found outside the history of the repository is held back with them
   * instead of being offered under another name.
   */
  held?: HeldCandidate[]

  /**
   * Action name in `owner/repo` format (path suffix is allowed).
   */
  actionName: string

  /**
   * Update mode that limits which tag can be selected.
   */
  mode: UpdateMode
}

/**
 * State of the walk after a candidate.
 */
interface WalkState {
  /**
   * Candidate the walk settled on, null while it goes on.
   */
  selected: CompatibleUpdate['selected']

  /**
   * Candidates held back so far.
   */
  held: HeldCandidate[]

  /**
   * Whether the walk stopped without a candidate.
   */
  stopped: boolean
}

/**
 * Resolve the newest compatible update for an action.
 *
 * The update mode limits the candidates, and each one, newest first, is
 * assessed by `assessCandidate`, the same rules every version an update offers
 * goes through. A candidate held back by the cool-down or by a trust check
 * steps down to the next one, and so does a tag that points at no commit. A
 * candidate whose date or commit could not be established stops the walk:
 * nothing is known against it, and stepping past it would offer an older
 * version for no reason while a failing API would cost a request per remaining
 * candidate.
 *
 * The age of a candidate is the age of its commit, so a floating `v4.3` at the
 * commit of a release `v4.3.1` inside the cool-down is held back with it unless
 * that commit is proven older. A tag the listing names at a commit already
 * found outside the history of the repository is skipped without a request, and
 * a tag resolved to such a commit is not reported again.
 *
 * @param client - GitHub client instance.
 * @param parameters - Lookup parameters.
 * @returns The selected tag, and the candidates held back on the way.
 * @throws GitHubRateLimitError - When a request the lookup needed was rate
 *   limited.
 */
export async function getCompatibleUpdate(
  client: GitHubClient,
  parameters: GetCompatibleUpdateParameters,
): Promise<CompatibleUpdate> {
  let { currentVersion, latestVersion, actionName, mode } = parameters
  let nothing: CompatibleUpdate = { selected: null, held: [] }

  let familyPrefix = getFamilyPrefix(currentVersion)

  if (familyPrefix === null) {
    return nothing
  }

  let segments = actionName.split('/')
  if (segments.length < 2) {
    return nothing
  }
  let [owner, repository] = segments
  if (!owner || !repository) {
    return nothing
  }

  /**
   * A named family is fetched by its own prefix, because it can otherwise fall
   * outside the single page of tags the listing returns.
   */
  let tags: TagInfo[]
  try {
    tags =
      familyPrefix === '' ?
        await client.getAllTags(owner, repository, 100)
      : await client.getMatchingTagReferences(owner, repository, familyPrefix)
  } catch (error) {
    /**
     * A rate limit says nothing about the tags, and reading it as an empty
     * listing would report the action as held back by the cool-down or the mode
     * when it was never checked.
     */
    if (isRateLimitError(error)) {
      throw error
    }
    return nothing
  }

  let candidates = findCompatibleTags(tags, currentVersion, {
    latestVersion,
    mode,
  }).filter(candidate => candidate.tag !== latestVersion)

  return walkCandidates(client, {
    cooldown: parameters.cooldown,
    held: parameters.held ?? [],
    repo: repository,
    candidates,
    owner,
  })
}

/**
 * Assess the candidates one after another until one passes or the walk stops.
 *
 * The lookups are chained rather than run together, so a step down by a single
 * release does not pay for the whole tag history.
 *
 * @param client - GitHub client instance.
 * @param parameters - Candidates and what the walk starts from.
 * @param parameters.candidates - Compatible tags ordered newest first.
 * @param parameters.cooldown - Cool-down to apply.
 * @param parameters.held - Candidates the caller already held back.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @returns The selected tag, and the candidates held back on the way.
 * @throws GitHubRateLimitError - When a candidate lookup was rate limited.
 */
async function walkCandidates(
  client: GitHubClient,
  parameters: {
    cooldown: Cooldown | null
    held: HeldCandidate[]
    candidates: TagInfo[]
    owner: string
    repo: string
  },
): Promise<CompatibleUpdate> {
  let { candidates, cooldown, owner, repo, held } = parameters

  /**
   * Being outside the history of the repository is a property of the commit,
   * unlike a moved tag, which is a property of the tag.
   */
  let untrustedCommits = new Set(
    held
      .filter(({ reason }) => reason === 'unreachable-commit')
      .map(({ sha }) => sha),
  )

  let walk = await candidates.reduce<Promise<WalkState>>(
    async (pending, candidate) => {
      let state = await pending
      if (state.selected || state.stopped) {
        return state
      }

      if (candidate.sha && untrustedCommits.has(candidate.sha)) {
        return state
      }

      let assessment = await assessCandidate(client, {
        sha: candidate.sha,
        tag: candidate.tag,
        cooldown,
        owner,
        repo,
      })

      /**
       * A tag that points at no commit is no candidate at all, such as one
       * deleted since the listing or one that points at a tree.
       */
      if (assessment.reason === 'no-commit') {
        return state
      }

      if (!assessment.reason) {
        return { ...state, selected: { version: candidate.tag, assessment } }
      }

      if (
        assessment.reason === 'unreachable-commit' &&
        untrustedCommits.has(assessment.sha)
      ) {
        return state
      }

      let nextHeld = [
        ...state.held,
        {
          reason: assessment.reason,
          version: candidate.tag,
          sha: assessment.sha,
        },
      ]

      if (assessment.reason === 'unreachable-commit') {
        untrustedCommits.add(assessment.sha)
      }

      return {
        stopped:
          !canStepPast(assessment.reason) ||
          untrustedCommits.size >= MAX_UNTRUSTED_COMMITS,
        held: nextHeld,
        selected: null,
      }
    },
    Promise.resolve({ selected: null, stopped: false, held: [] }),
  )

  return { selected: walk.selected, held: walk.held }
}

/**
 * Recognize the error the client reports a rate-limited request with.
 *
 * @param error - Error thrown by a lookup.
 * @returns True when the request was rate limited.
 */
function isRateLimitError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'GitHubRateLimitError'
}

/**
 * Check whether the walk may step past a candidate held back for a reason.
 *
 * @param reason - Why the candidate was held back.
 * @returns True for a commit too recent or outside the history, which judges
 *   the candidate itself; false for an answer that could not be established.
 */
function canStepPast(reason: CandidateHoldReason): boolean {
  return reason === 'cool-down' || reason === 'unreachable-commit'
}
