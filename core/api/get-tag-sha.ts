import type { GitHubClientContext } from '../../types/github-client-context'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Resolve the commit a tag points at right now, read from the tag reference.
 *
 * This is the only source of a commit SHA an update may write. A release also
 * names a commitish in `target_commitish`, but GitHub keeps that value when the
 * tag already existed or was moved afterwards, so it can name a different
 * commit than the one the tag runs.
 *
 * Uses the exact-match `git/ref/tags` endpoint, so a tag that exists only as a
 * prefix of other tags (e.g. `v8` with only `v8.3.2` published) resolves to
 * null. An annotated tag is followed to its tag object, and a tag object that
 * names anything other than a commit leaves the tag without a commit to pin.
 *
 * Only an answer is final. A 404 for the reference or the tag object answers
 * null, and the client keeps it for the rest of the run. Any other failure is
 * thrown and forgotten, so a server error is never read as a missing tag and a
 * later lookup asks again.
 *
 * The answer holds for this tag only. Git allows `#` and `%` in a tag name,
 * which would end the path or turn into other characters on the way, so the
 * name is sent percent-encoded, and a reference that names another tag is
 * reported as a failure rather than taken for this one.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name (may include 'refs/tags/' prefix).
 * @returns Commit SHA, or null when the tag points at no commit.
 * @throws GitHubRateLimitError - When a request was rate limited.
 * @throws Error - When a request failed for any reason other than a 404, or
 *   GitHub answered with the reference of another tag.
 */
export async function getTagSha(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string; tag: string },
): Promise<string | null> {
  let { owner, repo, tag } = parameters
  let displayTag = tag.replace(/^refs\/tags\//u, '')

  try {
    let referenceResponse = await makeRequest(
      context,
      `/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(displayTag)}`,
    )
    let { object, ref } = referenceResponse.data as {
      object: { type: string; sha: string }
      ref: string
    }

    if (ref !== `refs/tags/${displayTag}`) {
      throw new Error(
        `GitHub answered for tag ${displayTag} with the reference ${ref}`,
      )
    }

    if (object.type === 'commit') {
      return object.sha
    }

    if (object.type !== 'tag') {
      return null
    }

    let tagResponse = await makeRequest(
      context,
      `/repos/${owner}/${repo}/git/tags/${object.sha}`,
    )
    let tagObject = tagResponse.data as {
      object: { type: string; sha: string }
    }

    /**
     * A tag object can point at another tag object rather than at a commit, and
     * that SHA names no commit either.
     */
    return tagObject.object.type === 'commit' ? tagObject.object.sha : null
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
