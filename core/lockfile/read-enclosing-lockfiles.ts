import { dirname } from 'node:path'

import type { WorkflowLockfile } from '../../types/workflow-lockfile'

import { readWorkflowLockfile } from './read-workflow-lockfile'

/**
 * Read the workflow lockfiles that may pin what the scanned files run.
 *
 * A lockfile, `.github/workflows/actions.lock`, belongs to the directory that
 * holds that `.github`, the root of its repository, and the workflows it tracks
 * may run an action anywhere below that root through a local reference. So the
 * lockfile of every directory that encloses a scanned file is read, not only
 * the one of the repository the run started in, and a run that scans the files
 * of several repositories finds the lockfile of each.
 *
 * @param directories - Real paths of the directories that hold scanned files.
 * @returns The lockfiles found, ordered by path.
 */
export async function readEnclosingLockfiles(
  directories: Iterable<string>,
): Promise<WorkflowLockfile[]> {
  let roots = new Set<string>()

  /**
   * Collect a directory and every directory that encloses it, once.
   *
   * @param directory - Absolute path.
   */
  function collect(directory: string): void {
    if (roots.has(directory)) {
      return
    }
    roots.add(directory)
    let parent = dirname(directory)
    if (parent !== directory) {
      collect(parent)
    }
  }

  for (let directory of directories) {
    collect(directory)
  }

  let lockfiles = await Promise.all([...roots].map(readWorkflowLockfile))
  return lockfiles
    .filter(lockfile => lockfile !== null)
    .toSorted((first, second) => first.path.localeCompare(second.path))
}
