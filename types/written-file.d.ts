/**
 * File the updater rewrote, with its text before and after.
 */
export interface WrittenFile {
  /**
   * Text the file held when it was read.
   */
  before: string

  /**
   * Text written to it.
   */
  after: string

  /**
   * Path of the file, as the scan names it.
   */
  path: string
}
