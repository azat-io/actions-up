import type { GitHubClientContext } from '../../types/github-client-context'
import type { BranchTipAt } from '../../types/branch-tip-at'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { parseTimestamp } from './parse-timestamp'
import { makeRequest } from './make-request'

/**
 * Most pages of branch history read before giving up on reaching a moment.
 *
 * A page holds 100 updates of the branch, newest first. The default branch of
 * an action moves a few times a day at most, so the moment a cool-down looks
 * back to is almost always on the first page. A branch busy enough to need more
 * than three pages leaves the tip undetermined instead of costing a request per
 * hundred updates.
 */
const MAX_PAGES = 3

/**
 * Earliest moment the recorded history is trusted to reach.
 *
 * GitHub started recording branch updates in early 2023. An earlier moment, or
 * an invalid one, may lie before the records begin, where the history would
 * read as if the branch had not moved.
 */
const HISTORY_START = Date.parse('2024-01-01T00:00:00.000Z')

/**
 * Kinds of update that only move a branch forward, so it keeps every commit it
 * held before.
 */
const FORWARD_UPDATES = new Set(['merge_queue_merge', 'pr_merge', 'push'])

/**
 * SHA GitHub reports for the side of an update on which the branch does not
 * exist: before it was created, or after it was deleted.
 */
const NO_COMMIT = '0'.repeat(40)

/**
 * Update of a branch as the repository activity endpoint reports it.
 */
interface BranchUpdatePayload {
  /**
   * Kind of update, such as `push`, `force_push` or `branch_deletion`.
   */
  activity_type: string

  /**
   * Moment GitHub applied the update.
   */
  timestamp: string

  /**
   * Commit the branch moved from.
   */
  before: string

  /**
   * Commit the branch moved to.
   */
  after: string

  /**
   * Fully qualified name of the updated branch.
   */
  ref: string
}

/**
 * What the pages read so far tell about the tip at the moment.
 */
interface HistoryState {
  /**
   * Earliest update read so far.
   */
  earliest: BranchUpdatePayload | null

  /**
   * The answer, once a page settled it.
   */
  tip?: BranchTipAt | null

  /**
   * API path of the next page to read, null once the answer is settled.
   */
  next: string | null
}

/**
 * Find which commit was at the tip of a branch at a past moment, as long as the
 * branch has held on to it since.
 *
 * GitHub records every update of a branch with its kind, the moment it was
 * applied and the commits the branch moved from and to. Those moments are
 * GitHub's own, unlike the dates written into a commit, so they tell when a
 * commit really became part of a branch.
 *
 * The updates are read newest first until one at or before the moment: the
 * commit it left at the tip was there at the moment. That tip only counts when
 * every later update moved the branch forward, so the branch has kept all of it
 * ever since: a force push, a deletion or an update of an unknown kind leaves
 * the answer open, and a branch created after the moment held nothing then.
 * When every recorded update came later, the branch held then the commit its
 * first recorded update moved away from. A branch without a single recorded
 * update leaves the answer open: the history names no commit then, and the tip
 * the branch has now may have arrived after the history was read. The pages are
 * read one after another, since each names the next.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.branch - Branch name.
 * @param parameters.at - Moment to look back to.
 * @returns The tip at the moment, or null when the answer stays open: the
 *   moment lies before the records or beyond the pages read, the branch has no
 *   recorded update, a recorded moment cannot be read, an update names another
 *   branch, or the branch was rewritten since.
 * @throws GitHubRateLimitError - When a request was rate limited.
 * @throws Error - When a request failed for any other reason.
 */
export async function getBranchTipAt(
  context: GitHubClientContext,
  parameters: { branch: string; owner: string; repo: string; at: Date },
): Promise<BranchTipAt | null> {
  let { branch, owner, repo, at } = parameters

  if (Number.isNaN(at.getTime()) || at.getTime() < HISTORY_START) {
    return null
  }

  let reference = `refs/heads/${branch}`
  let start: HistoryState = {
    next: `/repos/${owner}/${repo}/activity?ref=${encodeURIComponent(reference)}&direction=desc&per_page=100`,
    earliest: null,
  }

  try {
    let history = await Array.from({ length: MAX_PAGES }).reduce<
      Promise<HistoryState>
    >(async pending => {
      let state = await pending
      return state.next ?
          readPage(context, {
            earliest: state.earliest,
            path: state.next,
            reference,
            at,
          })
        : state
    }, Promise.resolve(start))

    return history.tip ?? null
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}

/**
 * Read one page of branch updates.
 *
 * @param context - Client context.
 * @param parameters - Page to read and what the earlier pages left.
 * @param parameters.earliest - Earliest update read on the earlier pages.
 * @param parameters.reference - Fully qualified name of the branch.
 * @param parameters.path - API path of the page.
 * @param parameters.at - Moment to look back to.
 * @returns The answer when the page settles it, otherwise the path of the next
 *   page.
 */
async function readPage(
  context: GitHubClientContext,
  parameters: {
    earliest: BranchUpdatePayload | null
    reference: string
    path: string
    at: Date
  },
): Promise<HistoryState> {
  let { reference, earliest, path, at } = parameters
  let response = await makeRequest(context, path)
  let updates = response.data as BranchUpdatePayload[]

  for (let update of updates) {
    let timestamp = parseTimestamp(update.timestamp)

    if (!timestamp || update.ref !== reference) {
      return { next: null, tip: null, earliest }
    }

    if (timestamp.getTime() <= at.getTime()) {
      return {
        tip: { sha: tipOf(update.after), since: timestamp },
        next: null,
        earliest,
      }
    }

    if (update.activity_type === 'branch_creation') {
      return { tip: { since: null, sha: null }, next: null, earliest }
    }

    if (!FORWARD_UPDATES.has(update.activity_type)) {
      return { next: null, tip: null, earliest }
    }
  }

  let earliestSoFar = updates.at(-1) ?? earliest
  let next = readNextPath(response.headers['link'])

  if (next) {
    return { earliest: earliestSoFar, next }
  }

  return {
    tip:
      earliestSoFar ? { sha: tipOf(earliestSoFar.before), since: null } : null,
    earliest: earliestSoFar,
    next: null,
  }
}

/**
 * Read the path of the next page from a `link` header.
 *
 * @param link - Value of the `link` header, empty when absent.
 * @returns API path of the next page, or null on the last page.
 */
function readNextPath(link = ''): string | null {
  let url = /<(?<url>[^>]+)>;\s*rel="next"/u.exec(link)?.groups?.['url']

  if (!url) {
    return null
  }

  let { pathname, search } = new URL(url)
  return `${pathname}${search}`
}

/**
 * Read the tip an update names on one side.
 *
 * @param sha - SHA the update names.
 * @returns The commit, or null when the branch did not exist on that side.
 */
function tipOf(sha: string): string | null {
  return sha === NO_COMMIT ? null : sha
}
