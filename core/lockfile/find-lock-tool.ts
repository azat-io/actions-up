import semver from 'semver'

import type { LockTool } from '../../types/lock-tool'

import { MIN_LOCK_TOOL_VERSION } from '../constants'
import { runGh } from './run-gh'

/**
 * Command name of the extension, as `gh extension list` shows it.
 */
const COMMAND = 'gh actions-lock'

/**
 * Milliseconds the list of extensions may take.
 */
const LIST_TIMEOUT = 30_000

/**
 * Find gh-actions-lock, the GitHub CLI extension that regenerates workflow
 * lockfiles.
 *
 * The list of installed extensions tells whether it is installed and which
 * release, and `gh` writes it without running any extension, so the time limit
 * ends the query for sure. A version that is not a release number, as with a
 * build from source, is accepted. Nothing is installed or upgraded here; a
 * missing or outdated tool is reported for the caller to say what fixes it. A
 * list that fails counts as one without the extension, as with the GitHub CLI
 * before 2.10, which fails the list when no extension is installed. Only a `gh`
 * that is not found counts as not installed: one that is there but cannot be
 * started, as without the permission to run it, needs another fix.
 *
 * @param cwd - Directory to run `gh` in.
 * @returns Whether the extension can be run, and why not when it cannot.
 */
export async function findLockTool(cwd: string): Promise<LockTool> {
  let list = await runGh(['extension', 'list'], { timeout: LIST_TIMEOUT, cwd })

  if (list.startError === 'ENOENT') {
    return 'no-gh'
  }

  /**
   * A list that did not finish, or that `gh` could not start, says nothing
   * about the extension, so it is not worth installing again for it.
   */
  if (list.exitCode === null) {
    return 'unlisted'
  }

  let version = list.exitCode === 0 ? findListedVersion(list.stdout) : null

  if (version === null) {
    return 'missing'
  }

  let release = semver.valid(version)
  return release && semver.lt(release, MIN_LOCK_TOOL_VERSION) ?
      'outdated'
    : 'available'
}

/**
 * Find the version of gh-actions-lock in the list of installed extensions.
 *
 * Written to a pipe, the list holds a line per extension with the command, the
 * repository and the version, separated by tabs.
 *
 * @param list - Output of `gh extension list`.
 * @returns The listed version, empty when none is listed, or null when the
 *   extension is not installed.
 */
function findListedVersion(list: string): string | null {
  for (let line of list.split('\n')) {
    let [command, , version = ''] = line.split('\t', 3)
    if (command?.trim() === COMMAND) {
      return version.trim()
    }
  }
  return null
}
