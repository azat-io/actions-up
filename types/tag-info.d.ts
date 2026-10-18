/**
 * Tag as a tag listing names it: its name and the commit it points at.
 */
export interface TagInfo {
  /**
   * Commit the tag points at, as GitHub derives it from the tag reference; null
   * for an annotated tag listed by name prefix, which names its tag object
   * instead.
   */
  sha: string | null

  /**
   * Tag name (e.g. V1.2.3).
   */
  tag: string
}
