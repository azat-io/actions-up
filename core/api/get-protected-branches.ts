import type { GitHubClientContext } from '../../types/github-client-context'
import type { BranchHead } from '../../types/branch-head'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * List the branches protected by branch protection rules or rulesets, with the
 * commit at the tip of each.
 *
 * Anyone who can push to a repository can create an unprotected branch, while a
 * protected one usually takes more than a push token to change, so only these
 * count as history a release can come from outside the default branch. The
 * first 100 are listed, far more than repositories protect.
 *
 * Every failure reaches the caller: an empty list would read as a repository
 * whose releases can only come from the default branch.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @returns Protected branches with their tips.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the request failed for any other reason.
 */
export async function getProtectedBranches(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string },
): Promise<BranchHead[]> {
  let { owner, repo } = parameters

  try {
    let response = await makeRequest(
      context,
      `/repos/${owner}/${repo}/branches?protected=true&per_page=100`,
    )
    let branches = response.data as { commit: { sha: string }; name: string }[]

    return branches.map(branch => ({
      sha: branch.commit.sha,
      name: branch.name,
    }))
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}
