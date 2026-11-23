/**
 * Workflow lockfile of a repository, `.github/workflows/actions.lock`, as far
 * as the update pipeline needs it, with the actions of the repository the
 * workflows it tracks run.
 */
export interface WorkflowLockfile {
  /**
   * Absolute real paths of the definitions (`action.yml`) of the actions of the
   * repository the tracked workflows run through local references, directly or
   * through one another, each with the absolute real paths of the workflows
   * that run it and whether the lockfile records what it runs under each of
   * them: it does for a workflow that reaches it through `$/` references alone.
   * A workflow that runs it only through `./` is listed only when it runs
   * remote actions. Null when a workflow or a definition could not be read, so
   * that any action of the repository may be one of them.
   */
  reached: Map<string, Map<string, boolean>> | null

  /**
   * Commit each pin of the lockfile resolves to, in lower case, by its key,
   * `owner/repo@ref` with the repository in lower case; null when the lockfile
   * cannot be read. A relock without `--relock` keeps the commit recorded for a
   * key, whichever workflow it was recorded for.
   */
  commits: Map<string, string> | null

  /**
   * Keys of the pins of each tracked workflow, `owner/repo@ref` with the
   * repository in lower case, by the key of the workflow; null when the
   * lockfile cannot be read.
   */
  pins: Map<string, string[]> | null

  /**
   * Paths the lockfile names the workflows it tracks by, relative to the root,
   * each mapped to the real path of the workflow; null when the lockfile cannot
   * be read. A relock names each workflow by its key, since gh-actions-lock
   * finds the entry of a workflow by the path it is given, even when that path
   * is a symbolic link.
   */
  keys: Map<string, string> | null

  /**
   * Absolute real paths of the tracked workflows that run, through a `./` or
   * `../` reference, an action that runs remote actions, or one the repository
   * does not hold, which may run any, as one outside the repository. The
   * reference may be written in the workflow or in any action of the repository
   * it reaches, and the workflow may reach the same action through `$/` as
   * well: gh-actions-lock never follows such a reference, so the lockfile
   * cannot record what it runs. Null when `reached` is.
   */
  unfollowed: Set<string> | null

  /**
   * Absolute real paths of the workflows treated as tracked: the ones the
   * lockfile names, or every workflow of `.github/workflows` when it cannot be
   * read; null when even those cannot be listed, so that any workflow next to
   * the lockfile may be one of them.
   */
  workflows: Set<string> | null

  /**
   * Absolute path of the first tracked workflow, or definition of an action of
   * the repository such a workflow runs, that could not be read, which leaves
   * `reached` null; null when every one could, or when the workflows could not
   * even be listed.
   */
  unreadable: string | null

  /**
   * Schema version the file names, null when it names none.
   */
  version: string | null

  /**
   * Why the file cannot be read, absent when it can.
   */
  error?: string

  /**
   * Root of the repository the lockfile belongs to.
   */
  root: string

  /**
   * Absolute path of the lockfile.
   */
  path: string
}
