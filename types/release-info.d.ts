/** Normalized release information used across the tool. */
export interface ReleaseInfo {
  /** Release description (body) or null when absent. */
  description: string | null

  /** True when the release is marked as prerelease. */
  isPrerelease: boolean

  /** Commit SHA associated with the release tag (may be null). */
  sha: string | null

  /** Publication date of the release. */
  publishedAt: Date

  /** Tag name (e.g. V1.2.3). */
  version: string

  /** Release name or tag name when name is not provided. */
  name: string

  /** HTML URL of the release page. */
  url: string
}
