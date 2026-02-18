import type { GitHubClientContext } from '../../types/github-client-context'
import type { ReleaseInfo } from '../../types/release-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Fetch the latest release for a repository.
 *
 * If the latest release does not exist (404), returns null. The commit SHA is
 * taken from target_commitish only when it looks like a SHA; otherwise SHA is
 * left null and may be resolved later via tag lookups.
 *
 * @param context - Client context.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @returns Last release info or null when no latest release exists.
 */
export async function getLatestRelease(
  context: GitHubClientContext,
  owner: string,
  repo: string,
): Promise<ReleaseInfo | null> {
  try {
    let releaseResp = await makeRequest(
      context,
      `/repos/${owner}/${repo}/releases/latest`,
    )
    let release = releaseResp.data as {
      target_commitish: string | null
      published_at: string
      name: string | null
      body: string | null
      prerelease: boolean
      tag_name: string
      html_url: string
    }

    let sha: string | null =
      isLikelySha(release.target_commitish) ? release.target_commitish : null

    return {
      publishedAt: new Date(release.published_at),
      name: release.name ?? release.tag_name,
      description: release.body ?? null,
      isPrerelease: release.prerelease,
      version: release.tag_name,
      url: release.html_url,
      sha,
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 404
    ) {
      return null
    }
    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}

function isLikelySha(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  let normalized = value.replace(/^v/u, '')
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}
