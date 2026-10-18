/**
 * Normalized release information used across the tool.
 */
export interface ReleaseInfo {
  /**
   * Release description (body) or null when absent.
   */
  description: string | null

  /**
   * Publication date of the release, null when GitHub sent one that cannot be
   * read.
   */
  publishedAt: Date | null

  /**
   * True when the release is marked as prerelease.
   */
  isPrerelease: boolean

  /**
   * True when the release is immutable, so its tag cannot be moved or deleted.
   */
  immutable: boolean

  /**
   * Tag name (e.g. V1.2.3).
   */
  version: string

  /**
   * Release name or tag name when name is not provided.
   */
  name: string

  /**
   * HTML URL of the release page.
   */
  url: string
}
