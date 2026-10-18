/**
 * Tag held back because the commit it points at failed a trust check.
 */
export interface TrustHold {
  /**
   * Why the tag is not trusted: `tag-moved` when a workflow pins another commit
   * under the version comment of this very tag, `unreachable-commit` when the
   * commit is on neither the default branch nor a protected branch of the
   * repository.
   */
  reason: 'unreachable-commit' | 'tag-moved'

  /**
   * Tag that was held back.
   */
  version: string

  /**
   * Commit the tag points at.
   */
  sha: string
}
