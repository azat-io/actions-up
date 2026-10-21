import { basename, dirname, resolve, join } from 'node:path'
import { realpath, readlink } from 'node:fs/promises'

import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { ScanResult } from '../../types/scan-result'

import { readEnclosingLockfiles } from '../lockfile/read-enclosing-lockfiles'
import { isLockedReference } from '../lockfile/is-locked-reference'
import { resolveScanDirectories } from './resolve-scan-directories'
import { anchorDirectoryInputs } from './anchor-directory-inputs'
import { findRepositoryRoot } from '../fs/find-repository-root'
import { scanGitHubActions } from '../scan-github-actions'
import { mergeScanResults } from './merge-scan-results'
import { scanRecursive } from '../scan-recursive'

/**
 * Everything a repository scan found.
 */
interface RepositoryScan {
  /**
   * Workflow lockfiles that may pin what the scanned files run, ordered by
   * path.
   */
  lockfiles: WorkflowLockfile[]

  /**
   * Actions and runners found, merged across the scanned directories.
   */
  scanResult: ScanResult

  /**
   * Absolute paths of the scanned directories.
   */
  directories: string[]
}

/**
 * Most symbolic links followed from a scanned file, as many as Linux follows.
 */
const MAX_SYMBOLIC_LINKS = 40

/**
 * Where to look for the workflows and actions of a repository.
 */
interface ScanRepositoryOptions {
  /**
   * Directories to scan, as given to `--dir`.
   */
  directories?: string[] | string

  /**
   * Whether the directories are searched for workflows recursively.
   */
  recursive?: boolean

  /**
   * Directory the scan starts from.
   */
  cwd: string
}

/**
 * Find the workflows and actions of a repository, the way `--dir` and
 * `--recursive` describe.
 *
 * Without `--recursive`, a directory is resolved against the root of the
 * repository the working directory belongs to.
 *
 * Every reference whose commit a workflow lockfile pins is marked as locked,
 * whichever repository its file belongs to, since writing it would leave that
 * lockfile stale.
 *
 * @param options - Where to look.
 * @returns The scanned directories, what they hold and the lockfiles found.
 */
export async function scanRepository(
  options: ScanRepositoryOptions,
): Promise<RepositoryScan> {
  let { recursive, cwd } = options
  let repositoryRoot = recursive ? null : await findRepositoryRoot(cwd)
  let directories = resolveScanDirectories({
    dir: anchorDirectoryInputs({
      dir: options.directories,
      root: repositoryRoot,
      cwd,
    }),
    recursive,
    cwd,
  })

  let scanResults =
    recursive ?
      await Promise.all(
        directories.map(({ root, dir }) => scanRecursive(root, dir)),
      )
    : await Promise.all(
        directories.map(({ root, dir }) => scanGitHubActions(root, dir)),
      )

  let scanResult = mergeScanResults(scanResults)
  let files = new Set(
    scanResult.actions.flatMap(({ file }) =>
      file === undefined ? [] : [file],
    ),
  )
  let names = new Map(
    await Promise.all(
      [...files].map(async file => [file, await findNames(file)] as const),
    ),
  )
  let lockfiles = await readEnclosingLockfiles(
    new Set(names.values().flatMap(list => list.map(name => dirname(name)))),
  )

  /**
   * Entries are changed in place, so the workflow map of the scan result, which
   * holds the same entries as its action list, shows the changes too.
   */
  for (let action of scanResult.actions) {
    if (action.file !== undefined) {
      let paths = names.get(action.file)!
      if (
        lockfiles.some(lockfile =>
          paths.some(file => isLockedReference(lockfile, { ...action, file })),
        )
      ) {
        action.locked = true
      }
    }
  }

  return {
    directories: directories.map(({ root, dir }) => resolve(root, dir)),
    scanResult,
    lockfiles,
  }
}

/**
 * Find the names a scanned file goes by.
 *
 * A file found through symbolic links is written through them, so it is matched
 * under each name on the way: where it was found, every link it leads through
 * and the file it is in the end. Each name is taken in the real path of its
 * directory, the way a lockfile names the files it pins.
 *
 * @param file - Absolute path of a scanned file, or of a link it leads through.
 * @param links - Links followed so far.
 * @returns The names, in the order the links are followed.
 */
async function findNames(file: string, links = 0): Promise<string[]> {
  let name = join(await toRealPath(dirname(file)), basename(file))
  let target: string

  try {
    target = await readlink(file)
  } catch {
    return [name]
  }

  return links < MAX_SYMBOLIC_LINKS ?
      [name, ...(await findNames(resolve(dirname(file), target), links + 1))]
    : [name]
}

/**
 * Resolve the symbolic links of a path.
 *
 * @param path - Absolute path.
 * @returns Real path, or the path as given when it cannot be resolved.
 */
async function toRealPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}
