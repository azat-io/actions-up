import type { LockRefusal } from './lock-refusal'
import type { LockFinding } from './lock-finding'
import type { LockPin } from './lock-pin'

/**
 * Outcome of regenerating a workflow lockfile with gh-actions-lock.
 */
export type RelockResult =
  | {
      /**
       * Findings that block the lockfile, in the order gh-actions-lock gave
       * them.
       */
      findings: LockFinding[]

      /**
       * Why it failed, in one line.
       */
      reason: string

      /**
       * It exited on its own without regenerating the lockfile, or could not be
       * started. It wrote nothing, unless it failed while writing.
       */
      kind: 'failed'
    }
  | {
      /**
       * References it refused to pin for a workflow, since the entry of the
       * workflow did not track their action.
       */
      refusals: LockRefusal[]

      /**
       * The lockfile was regenerated.
       */
      kind: 'relocked'

      /**
       * What the lockfile pins for the workflows it was regenerated for, merged
       * across them.
       */
      pins: LockPin[]
    }
  | {
      /**
       * Signal that ended `gh`.
       */
      signal: NodeJS.Signals

      /**
       * A signal ended `gh`, so what it wrote is unknown.
       */
      kind: 'stopped'
    }
