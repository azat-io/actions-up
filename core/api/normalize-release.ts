import type { ReleaseInfo } from '../../types/release-info'

/**
 * Release fields read from the GitHub releases API.
 */
export interface GitHubReleasePayload {
  /**
   * Branch name or commit SHA the release tag was created from.
   */
  target_commitish: string | null

  /**
   * Publication timestamp in ISO 8601 format.
   */
  published_at: string

  /**
   * Release title, null when not set.
   */
  name: string | null

  /**
   * Release notes, null when empty.
   */
  body: string | null

  /**
   * True when the release is marked as prerelease.
   */
  prerelease: boolean

  /**
   * HTML URL of the release page.
   */
  html_url: string

  /**
   * Tag name of the release.
   */
  tag_name: string
}

/**
 * Convert a GitHub release payload into normalized release information.
 *
 * @param release - Release payload returned by the GitHub API.
 * @param sha - Commit SHA of the release tag, null when unknown.
 * @returns Normalized release information.
 */
export function normalizeRelease(
  release: GitHubReleasePayload,
  sha: string | null,
): ReleaseInfo {
  return {
    publishedAt: new Date(release.published_at),
    name: release.name ?? release.tag_name,
    description: release.body ?? null,
    isPrerelease: release.prerelease,
    version: release.tag_name,
    url: release.html_url,
    sha,
  }
}
