import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { ActionUpdate } from '../../types/action-update'
import type { GitHubClient } from '../../types/github-client'

import { isSha } from '../versions/is-sha'

/**
 * Tell whether writing a locked update and regenerating its lockfile could move
 * the workflow back to an older commit.
 *
 * A relock without `--relock` keeps the commit the lockfile already pins for a
 * reference, as for another workflow, so the reference an update writes then
 * runs that commit rather than the checked one. That leaves the workflow where
 * it is when it runs the kept commit already, and moves it forward when GitHub
 * finds the commit it runs in the history of the kept one, as for an update to
 * the next major version whose floating tag the lockfile pins at an older
 * commit than the checked one; the regeneration then names the kept commit.
 * Otherwise the update is taken for one that moves the workflow back: GitHub
 * finds the kept commit older, the two have diverged or share no history, or
 * the comparison failed, which leaves the direction open. So is an update while
 * the commit the workflow runs is unknown, and one that writes the checked
 * commit the workflow runs already, only in another form, as a tag of the
 * latest version written as its floating tag, which could only move the
 * workflow off that commit. A rate limit is let through, since it hides the
 * answer instead of giving one. The commit the workflow runs is the one its SHA
 * names, or the one the lockfile pins for the reference as written. References
 * are matched the way the lockfile keys them: by the repository in lower case,
 * without the path of an action in a subdirectory, and the reference as
 * written.
 *
 * @param update - Locked update, with the reference it writes resolved.
 * @param lockfile - Lockfile that pins what the file of the update runs.
 * @param client - GitHub client that compares commits of the repository of the
 *   action.
 * @returns True when the lockfile pins the reference the update writes at
 *   another commit than the checked one, unless the workflow runs that commit
 *   already, or GitHub finds it newer than the one the workflow runs, which is
 *   not the checked one.
 * @throws GitHubRateLimitError - When the comparison was rate limited.
 */
export async function movesWorkflowBack(
  update: Pick<ActionUpdate, 'targetRef' | 'latestSha' | 'action'>,
  lockfile: Pick<WorkflowLockfile, 'commits'>,
  client: Pick<GitHubClient, 'compareCommits'>,
): Promise<boolean> {
  let { latestSha, targetRef, action } = update
  let { commits } = lockfile
  let [owner, repository] = action.name.split('/', 2)

  if (!commits || !owner || !repository || !targetRef) {
    return false
  }

  let name = `${owner}/${repository}`.toLowerCase()
  let checked = latestSha?.toLowerCase()
  let kept = commits.get(`${name}@${targetRef}`)

  if (kept === undefined || kept === checked) {
    return false
  }

  let current = action.version
  if (!current) {
    return true
  }

  let running =
    isSha(current) ? current.toLowerCase() : commits.get(`${name}@${current}`)

  if (running === kept) {
    return false
  }
  if (running === undefined || running === checked) {
    return true
  }

  try {
    let status = await client.compareCommits(owner, repository, {
      base: running,
      head: kept,
    })
    return status !== 'ahead' && status !== 'identical'
  } catch (error) {
    if (error instanceof Error && error.name === 'GitHubRateLimitError') {
      throw error
    }
    return true
  }
}
