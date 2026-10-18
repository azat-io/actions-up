import type { ReleaseInfo } from '../../types/release-info'

import { parseTimestamp } from './parse-timestamp'

/**
 * Release fields read from the GitHub releases API.
 */
export interface GitHubReleasePayload {
  /**
   * Branch name or commit SHA the release tag was created from. Never read for
   * a commit: GitHub keeps it when the tag already existed or was moved later.
   */
  target_commitish: string | null

  /**
   * Publication timestamp in ISO 8601 format.
   */
  published_at: string

  /**
   * True when the release is immutable, so its tag cannot be moved or deleted.
   * Absent from GitHub versions that predate immutable releases.
   */
  immutable?: boolean

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
 * @returns Normalized release information.
 */
export function normalizeRelease(release: GitHubReleasePayload): ReleaseInfo {
  return {
    publishedAt: parseTimestamp(release.published_at),
    name: release.name ?? release.tag_name,
    immutable: release.immutable === true,
    description: release.body ?? null,
    isPrerelease: release.prerelease,
    version: release.tag_name,
    url: release.html_url,
  }
}
