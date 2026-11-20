import type { WorkflowLockfile } from './workflow-lockfile'

/**
 * Why a workflow lockfile pins what a scanned file runs.
 */
export interface LockedFile {
  /**
   * Keys of the tracked workflows under which the lockfile records what the
   * file runs, as it names them: the file itself when the lockfile tracks it as
   * a workflow, and the workflows that run it, each through `$/` references
   * alone, when it defines an action of the repository. Null when there are
   * none, when a workflow runs the action only through `./`, when one of the
   * workflows runs remote actions through `./` alone, or when the lockfile, the
   * workflows or the actions of the repository they run cannot be read, so that
   * none of its workflows is relocked.
   */
  workflows: string[] | null

  /**
   * Lockfile that pins what the file runs.
   */
  lockfile: WorkflowLockfile
}
