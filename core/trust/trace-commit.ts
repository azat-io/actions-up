import semver from 'semver'

import type { CommitTrace, Verdict } from '../../types/commit-trace'
import type { GitHubClient } from '../../types/github-client'
import type { BranchHead } from '../../types/branch-head'

import { parseTagFamily } from '../versions/parse-tag-family'

/**
 * Most distinct tips of protected branches a commit is compared with.
 *
 * A release cut from a maintenance branch such as `releases/v4` is the expected
 * case, and the branches that name the major version of the release go first,
 * so one comparison usually settles it. Branches at the same tip answer the
 * same comparison, so a tip is compared once. A commit not found within the
 * limit is left unverified rather than declared outside the history.
 */
const MAX_BRANCH_COMPARISONS = 3

/**
 * Most protected branches whose recorded history is read to date a commit.
 *
 * Only a branch that holds the commit can date it, and each one by its own
 * history, even at the same tip as another: one may have held the commit for a
 * month, another since yesterday. A commit none of them dates within the limit
 * is left undated rather than declared too recent.
 */
const MAX_BRANCH_HISTORIES = 3

/**
 * Size of the single page of protected branches read. A full page may go on, so
 * a commit missing from it is not declared outside the history.
 */
const PROTECTED_BRANCHES_PAGE = 100

/**
 * What the protected branches tell about a commit.
 */
interface BranchSearch {
  /**
   * Moment of the branch update that left a tip holding the commit, when a
   * branch dates the commit and that update is recorded.
   */
  heldSince: Date | null

  /**
   * Whether one of them already held the commit at the moment and has kept it
   * since.
   */
  heldAtCutoff: Verdict

  /**
   * Whether one of them holds the commit now.
   */
  inHistory: Verdict
}

/**
 * Trace a commit through the history of its repository: whether the default
 * branch or a protected branch holds it, and, given a moment to look back to,
 * whether one of them has held it since then.
 *
 * GitHub resolves a commit SHA through the whole fork network, so a tag can
 * point at a commit that was only ever pushed to a fork, or at one no branch
 * contains, which is where the tags of hijacked actions pointed. Only branches
 * count as history here. Tags do not, since the tag being checked is what an
 * attacker moves, and neither do unprotected branches, which a push token can
 * create. A protected branch is only as safe as the rules that let someone
 * create it, though: a rule written as a pattern such as `releases/*` covers a
 * branch created a moment ago.
 *
 * Every answer comes from GitHub: comparisons, and the recorded history of
 * branch updates with GitHub's own timestamps and kinds. A commit has been on a
 * branch since before the moment when the tip the branch had then contains it
 * and the branch has only moved forward since, whatever dates the commit
 * carries. Each branch tells that by its own history, so one that holds the
 * commit but got it too late does not stop another from dating it. When an
 * answer cannot be established, the trace says so instead of guessing.
 *
 * @param client - GitHub client instance.
 * @param parameters - Commit to trace.
 * @param parameters.cutoff - Moment to look back to, null to skip that
 *   question.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.sha - Full SHA of the commit.
 * @param parameters.tag - Tag pointing at the commit, used to rank branches.
 * @returns Where the commit sits.
 * @throws GitHubRateLimitError - When a request was rate limited.
 */
export async function traceCommit(
  client: GitHubClient,
  parameters: {
    cutoff: Date | null
    owner: string
    repo: string
    sha: string
    tag: string
  },
): Promise<CommitTrace> {
  let { cutoff, owner, repo, sha, tag } = parameters
  let defaultBranch: string

  try {
    defaultBranch = await client.getDefaultBranch(owner, repo)
  } catch (error) {
    rethrowRateLimit(error)
    return { inHistory: 'unknown', heldAtCutoff: null, heldSince: null }
  }

  /**
   * A commit long on the default branch, the common case, settles both
   * questions with the tip the branch had at the moment and one comparison: the
   * tip only counts when the branch has only moved forward since, so it still
   * holds the commit.
   */
  let atCutoff =
    cutoff ?
      await checkHeldAt(client, {
        branch: defaultBranch,
        cutoff,
        owner,
        repo,
        sha,
      })
    : null

  if (atCutoff?.verdict === 'yes') {
    return { heldSince: atCutoff.since, heldAtCutoff: 'yes', inHistory: 'yes' }
  }

  let onDefaultBranch = await checkHeld(client, {
    base: `refs/heads/${defaultBranch}`,
    owner,
    repo,
    sha,
  })

  if (!atCutoff && onDefaultBranch === 'yes') {
    return { heldAtCutoff: null, inHistory: 'yes', heldSince: null }
  }

  /**
   * The protected branches are searched even for a commit the default branch
   * holds, since one of them may date it: a release cut on a maintenance branch
   * a month ago can reach the default branch only yesterday.
   */
  let search = await searchProtectedBranches(client, {
    defaultBranch,
    cutoff,
    owner,
    repo,
    sha,
    tag,
  })
  let inHistory = either(onDefaultBranch, search.inHistory)

  if (!atCutoff) {
    return { heldAtCutoff: null, heldSince: null, inHistory }
  }

  /**
   * A branch that no longer holds the commit has not kept it since the moment,
   * whatever its history leaves open.
   */
  let keptByDefaultBranch = onDefaultBranch === 'no' ? 'no' : atCutoff.verdict

  return {
    heldAtCutoff: either(keptByDefaultBranch, search.heldAtCutoff),
    heldSince: search.heldSince,
    inHistory,
  }
}

/**
 * Search the protected branches for one that holds a commit, and, given a
 * moment to look back to, for one that has held it since then.
 *
 * The branches at the commit go first, then those that name the major version
 * of the tag. A tip is compared once, however many branches share it, but each
 * branch that holds the commit is dated by its own history. Branches past a
 * limit, or past a full page of the listing, leave the answers open instead of
 * counting as branches without the commit.
 *
 * @param client - GitHub client instance.
 * @param parameters - Commit to look for.
 * @param parameters.cutoff - Moment to look back to, null to stop at the first
 *   branch that holds the commit.
 * @param parameters.defaultBranch - Name of the default branch, already asked.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.sha - Full SHA of the commit.
 * @param parameters.tag - Tag pointing at the commit, used to rank branches.
 * @returns What the protected branches tell.
 * @throws GitHubRateLimitError - When a request was rate limited.
 */
async function searchProtectedBranches(
  client: GitHubClient,
  parameters: {
    defaultBranch: string
    cutoff: Date | null
    owner: string
    repo: string
    sha: string
    tag: string
  },
): Promise<BranchSearch> {
  let { defaultBranch, cutoff, owner, repo, sha, tag } = parameters
  let listed: BranchHead[]

  try {
    listed = await client.getProtectedBranches(owner, repo)
  } catch (error) {
    rethrowRateLimit(error)
    return { heldAtCutoff: 'unknown', inHistory: 'unknown', heldSince: null }
  }

  let unlisted: Verdict =
    listed.length < PROTECTED_BRANCHES_PAGE ? 'no' : 'unknown'
  let branches = rankBranches(
    listed.filter(branch => branch.name !== defaultBranch),
    { sha, tag },
  )
  let comparisons = new Map<string, Verdict>()
  let histories = 0

  return branches.reduce<Promise<BranchSearch>>(
    async (pending, branch) => {
      let search = await pending

      if (
        search.heldAtCutoff === 'yes' ||
        (!cutoff && search.inHistory === 'yes')
      ) {
        return search
      }

      let holds = branch.sha === sha ? 'yes' : comparisons.get(branch.sha)

      if (!holds && comparisons.size < MAX_BRANCH_COMPARISONS) {
        holds = await checkHeld(client, { base: branch.sha, owner, repo, sha })
        comparisons.set(branch.sha, holds)
      }

      holds ??= 'unknown'

      if (holds !== 'yes') {
        return {
          heldAtCutoff: either(search.heldAtCutoff, holds),
          inHistory: either(search.inHistory, holds),
          heldSince: null,
        }
      }

      /**
       * Without a moment the first branch that holds the commit settles the
       * search. Past the limit, a branch that holds it leaves its date open.
       */
      if (!cutoff || histories >= MAX_BRANCH_HISTORIES) {
        return { heldAtCutoff: 'unknown', inHistory: 'yes', heldSince: null }
      }

      histories += 1

      let held = await checkHeldAt(client, {
        branch: branch.name,
        cutoff,
        owner,
        repo,
        sha,
      })

      return {
        heldAtCutoff: either(search.heldAtCutoff, held.verdict),
        heldSince: held.since,
        inHistory: 'yes',
      }
    },
    Promise.resolve({
      heldAtCutoff: unlisted,
      inHistory: unlisted,
      heldSince: null,
    }),
  )
}

/**
 * Check whether a branch already held a commit at a past moment and has kept it
 * since.
 *
 * @param client - GitHub client instance.
 * @param parameters - Branch, commit and moment.
 * @param parameters.branch - Branch name.
 * @param parameters.cutoff - Moment to look back to.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.sha - Full SHA of the commit.
 * @returns Whether it did, and since when the tip that held it was in place.
 * @throws GitHubRateLimitError - When a request was rate limited.
 */
async function checkHeldAt(
  client: GitHubClient,
  parameters: {
    branch: string
    owner: string
    cutoff: Date
    repo: string
    sha: string
  },
): Promise<{ since: Date | null; verdict: Verdict }> {
  let { branch, cutoff, owner, repo, sha } = parameters
  let tip

  try {
    tip = await client.getBranchTipAt(owner, repo, { at: cutoff, branch })
  } catch (error) {
    rethrowRateLimit(error)
    return { verdict: 'unknown', since: null }
  }

  if (!tip) {
    return { verdict: 'unknown', since: null }
  }

  if (!tip.sha) {
    return { verdict: 'no', since: null }
  }

  let verdict = await checkHeld(client, { base: tip.sha, owner, repo, sha })
  return { since: verdict === 'yes' ? tip.since : null, verdict }
}

/**
 * Order the branches by how likely they are to hold a commit: those at the
 * commit first, then those that name the major version of its tag, such as
 * `releases/v4` for `v4.3.1`, keeping the order within each group.
 *
 * @param branches - Branches to rank.
 * @param commit - Commit and the tag pointing at it.
 * @param commit.sha - Full SHA of the commit.
 * @param commit.tag - Tag whose major version to look for.
 * @returns Ranked branches.
 */
function rankBranches(
  branches: BranchHead[],
  commit: { sha: string; tag: string },
): BranchHead[] {
  let family = parseTagFamily(commit.tag)
  let major = family ? String(semver.major(family.version)) : null
  let others = branches.filter(branch => branch.sha !== commit.sha)

  return [
    ...branches.filter(branch => branch.sha === commit.sha),
    ...others.filter(branch => namesMajor(branch, major)),
    ...others.filter(branch => !namesMajor(branch, major)),
  ]
}

/**
 * Check whether a base contains a commit.
 *
 * @param client - GitHub client instance.
 * @param parameters - Base and commit.
 * @param parameters.base - Fully qualified branch name or commit SHA.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.sha - Full SHA of the commit.
 * @returns `yes` or `no`, or `unknown` when the comparison failed.
 * @throws GitHubRateLimitError - When the request was rate limited.
 */
async function checkHeld(
  client: GitHubClient,
  parameters: { owner: string; base: string; repo: string; sha: string },
): Promise<Verdict> {
  let { owner, base, repo, sha } = parameters

  try {
    let status = await client.compareCommits(owner, repo, { head: sha, base })
    return status === 'behind' || status === 'identical' ? 'yes' : 'no'
  } catch (error) {
    rethrowRateLimit(error)
    return 'unknown'
  }
}

/**
 * Combine two answers to whether any of several branches does something.
 *
 * @param first - One answer.
 * @param second - Another answer.
 * @returns `yes` when either is, `no` when both are, `unknown` otherwise.
 */
function either(first: Verdict, second: Verdict): Verdict {
  if (first === 'yes' || second === 'yes') {
    return 'yes'
  }
  return first === 'no' && second === 'no' ? 'no' : 'unknown'
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

/**
 * Check whether a branch names a major version, as `releases/v4` and `4.x` name
 * 4 while `v14` does not.
 *
 * @param branch - Branch to check.
 * @param major - Major version to look for, null when the tag names none.
 * @returns True when a number in the branch name is the major version.
 */
function namesMajor(branch: BranchHead, major: string | null): boolean {
  return major !== null && branch.name.split(/\D+/u).includes(major)
}
