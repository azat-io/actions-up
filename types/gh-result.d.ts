/**
 * How a `gh` command ended and what it printed.
 */
export interface GhResult {
  /**
   * Signal that ended `gh`, null when it exited on its own.
   */
  signal: NodeJS.Signals | null

  /**
   * Code of the error that kept `gh` from starting, such as `ENOENT` when it is
   * not installed; null when it started, or when the error has no code.
   */
  startError: string | null

  /**
   * Exit code, null when `gh` could not be started or was ended by a signal.
   */
  exitCode: number | null

  /**
   * Whether `gh` could be started at all: false when it is not installed, or
   * cannot be run.
   */
  started: boolean

  /**
   * Standard output.
   */
  stdout: string

  /**
   * Standard error.
   */
  stderr: string
}
