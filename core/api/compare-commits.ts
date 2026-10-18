import type { GitHubClientContext } from '../../types/github-client-context'
import type { ComparisonStatus } from '../../types/comparison-status'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Compare a commit with a base of the same repository.
 *
 * GitHub computes the answer from the history of the repository, so a publisher
 * cannot shape it with the dates or messages they write. It is equally willing
 * to compare commits that exist only in a fork of the repository, which makes
 * it the way to tell a commit of the repository's own history from one that
 * merely resolves through the fork network.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.base - Base: a fully qualified branch name such as
 *   `refs/heads/main`, or a commit SHA.
 * @param parameters.head - Full SHA of the commit to compare.
 * @returns How the commit relates to the base, or null when GitHub answers with
 *   a 404, as it does when the two share no history at all.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the request failed for any reason other than a 404.
 */
export async function compareCommits(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string; base: string; head: string },
): Promise<ComparisonStatus | null> {
  let { owner, repo, base, head } = parameters

  try {
    let response = await makeRequest(
      context,
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${head}`,
    )
    return (response.data as { status: ComparisonStatus }).status
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    if (error instanceof Error && 'status' in error && error.status === 404) {
      return null
    }
    throw error
  }
}
