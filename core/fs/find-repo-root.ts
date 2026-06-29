import { dirname, resolve, join } from 'node:path'
import { stat } from 'node:fs/promises'

import { GITHUB_DIRECTORY } from '../constants'

/**
 * Walks up from a starting directory to find the repository root.
 *
 * The root is the nearest ancestor (including the start) that contains a `.git`
 * entry — a directory in a normal clone or a file in a git worktree — or, as a
 * fallback for non-git checkouts, a `.github` directory. Returns null when no
 * such ancestor exists up to the filesystem root.
 *
 * @param startDirectory - Absolute path to start searching from.
 * @returns The repository root directory, or null when none is found.
 */
export async function findRepoRoot(
  startDirectory: string,
): Promise<string | null> {
  let current = resolve(startDirectory)

  if (await pathExists(join(current, '.git'))) {
    return current
  }
  if (await pathExists(join(current, GITHUB_DIRECTORY))) {
    return current
  }

  let parent = dirname(current)
  if (parent === current) {
    return null
  }
  return await findRepoRoot(parent)
}

/**
 * Probes whether a filesystem path exists.
 *
 * @param path - The path to probe.
 * @returns True when the path exists, false otherwise.
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
