/** Normalized tag information (message/date) and the resolved commit SHA. */
export interface TagInfo {
  /** Tag or commit message, null when absent. */
  message: string | null

  /** Commit SHA the tag ultimately points to (may be null). */
  sha: string | null

  /** Date associated with the tag (from release, tagger or commit). */
  date: Date | null

  /** Tag name (e.g. V1.2.3). */
  tag: string
}
