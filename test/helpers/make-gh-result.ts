import type { GhResult } from '../../types/gh-result'

/**
 * Create the result of a `gh` command that exited with code 0 and printed
 * nothing, with the given fields changed.
 *
 * @param overrides - Fields to set instead of the defaults.
 * @returns How the command ended and what it printed.
 */
export function makeGhResult(overrides: Partial<GhResult> = {}): GhResult {
  return {
    startError: null,
    started: true,
    signal: null,
    exitCode: 0,
    stdout: '',
    stderr: '',
    ...overrides,
  }
}
