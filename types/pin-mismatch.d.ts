/**
 * Written reference that a regenerated workflow lockfile does not pin the way
 * Actions Up checked it.
 */
export type PinMismatch =
  | {
      /**
       * The lockfile pins another commit than the checked one: `kept-commit`
       * when it pinned that commit before, as for another workflow that runs
       * the reference, so the files match it but run that commit, and
       * `other-commit` when it did not, so the reference moved after the
       * check.
       */
      kind: 'other-commit' | 'kept-commit'

      /**
       * Reference, `owner/repo@ref`, as the updates name it.
       */
      reference: string

      /**
       * Commit Actions Up checked.
       */
      checked: string

      /**
       * Commit the lockfile pins.
       */
      pinned: string
    }
  | {
      /**
       * The relock reported the reference as pinned, but the lockfile on disk
       * does not record it for a workflow, or records another commit for it.
       */
      kind: 'not-on-disk'

      /**
       * Reference, `owner/repo@ref`, as the updates name it.
       */
      reference: string

      /**
       * Workflow the reference is not pinned for, relative to the repository
       * root.
       */
      workflow: string
    }
  | {
      /**
       * Reference, `owner/repo@ref`, as the updates name it.
       */
      reference: string

      /**
       * Workflow the reference is not pinned for, relative to the repository
       * root.
       */
      workflow: string

      /**
       * The relock refused to pin the reference for a workflow.
       */
      kind: 'refused'
    }
  | {
      /**
       * Reference, `owner/repo@ref`, as the updates name it.
       */
      reference: string

      /**
       * The lockfile does not pin the reference at all.
       */
      kind: 'missing'
    }
