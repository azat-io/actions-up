/**
 * Which workflows a workflow lockfile tracks, or why it cannot be read.
 */
export type LockfileParseResult =
  | {
      /**
       * Schema version the file names, null when it names none.
       */
      version: string | null

      /**
       * The file cannot be read.
       */
      kind: 'unsupported'

      /**
       * Why, worded to follow "the lockfile cannot be read because".
       */
      reason: string
    }
  | {
      /**
       * Paths of the tracked workflows, relative to the repository root.
       */
      workflows: string[]

      /**
       * Schema version of the file.
       */
      version: string

      /**
       * The file was read.
       */
      kind: 'parsed'
    }
