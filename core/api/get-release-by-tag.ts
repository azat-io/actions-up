import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubReleasePayload } from './normalize-release'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { normalizeRelease } from './normalize-release'
import { makeRequest } from './make-request'

/**
 * Fetch the published release of a tag.
 *
 * The cool-down holds back a tag whose release is recent, and dates the commit
 * of an immutable release, whose tag cannot move, by its publication date,
 * which nobody can change afterwards. A failed lookup answers neither question,
 * so it reaches the caller instead of passing for a tag without a release.
 *
 * Either answer holds for one tag only. Git allows `#` and `%` in a tag name,
 * which would end the path or turn into other characters on the way, so the
 * name is sent percent-encoded: sent as it is, `channel#v2.0.0` would fetch the
 * release of `channel`. A release that names another tag is reported as a
 * failure rather than taken for this one.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name.
 * @returns The release, or null when the tag has no published release.
 * @throws GitHubRateLimitError - When the request was rate limited.
 * @throws Error - When the request failed for any reason other than a 404, or
 *   GitHub answered with the release of another tag.
 */
export async function getReleaseByTag(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string; tag: string },
): Promise<ReleaseInfo | null> {
  let { owner, repo, tag } = parameters
  let release: GitHubReleasePayload

  try {
    let response = await makeRequest(
      context,
      `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    )
    release = response.data as GitHubReleasePayload
  } catch (error) {
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    if (error instanceof Error && 'status' in error && error.status === 404) {
      return null
    }
    throw error
  }

  if (release.tag_name !== tag) {
    throw new Error(
      `GitHub answered for tag ${tag} with the release of ${release.tag_name}`,
    )
  }

  return normalizeRelease(release)
}
