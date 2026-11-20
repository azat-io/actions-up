/**
 * How a `gh` command ended and what it printed.
 */
export interface GhResult {
  /**
   * Signal that ended `gh`, null when it exited on its own.
   */
  signal: NodeJS.Signals | null

  /**
   * Exit code, null when `gh` could not be started or was ended by a signal.
   */
  exitCode: number | null

  /**
   * Whether `gh` could be started at all: false when it is not installed.
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
