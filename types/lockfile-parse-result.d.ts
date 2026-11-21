/**
 * Which workflows a workflow lockfile tracks and which commit it pins each
 * reference to, or why it cannot be read.
 */
export type LockfileParseResult =
  | {
      /**
       * Commit each pin resolves to, in lower case and without the `sha1-`
       * prefix the file writes it with, by the key of the pin:
       * `owner/repo@ref`, with the repository in lower case.
       */
      commits: Map<string, string>

      /**
       * Keys of the pins of each tracked workflow, `owner/repo@ref` with the
       * repository in lower case, by the path of the workflow; an entry that
       * names no reference is left out.
       */
      pins: Map<string, string[]>

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
