import type { GitHubClientContext } from '../../types/github-client-context'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Read the name of the default branch of a repository.
 *
 * The provenance check compares a commit with the default branch by its fully
 * qualified name. `HEAD` would save this request, but a push token can create a
 * branch literally named `HEAD`, and the name GitHub would then resolve is not
 * documented.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @returns Name of the default branch.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the request failed for any other reason.
 */
export async function getDefaultBranch(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string },
): Promise<string> {
  let { owner, repo } = parameters

  try {
    let response = await makeRequest(context, `/repos/${owner}/${repo}`)
    return (response.data as { default_branch: string }).default_branch
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}
