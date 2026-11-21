import { basename, dirname, resolve, join } from 'node:path'
import { readlink } from 'node:fs/promises'

import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { LockedFile } from '../../types/locked-file'
import type { ScanResult } from '../../types/scan-result'

import { readEnclosingLockfiles } from '../lockfile/read-enclosing-lockfiles'
import { isLockedReference } from '../lockfile/is-locked-reference'
import { resolveScanDirectories } from './resolve-scan-directories'
import { anchorDirectoryInputs } from './anchor-directory-inputs'
import { findRepositoryRoot } from '../fs/find-repository-root'
import { scanGitHubActions } from '../scan-github-actions'
import { mergeScanResults } from './merge-scan-results'
import { scanRecursive } from '../scan-recursive'
import { toRealPath } from '../fs/to-real-path'

/**
 * Everything a repository scan found.
 */
interface RepositoryScan {
  /**
   * Scanned files whose actions a workflow lockfile pins, as the scan names
   * them, each with the lockfiles that pin them.
   */
  lockedFiles: Map<string, LockedFile[]>

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
 * lockfile stale. Its file is listed with the lockfiles that pin it and the
 * workflows under which each records what it runs, so that the lockfiles can be
 * regenerated for it.
 *
 * @param options - Where to look.
 * @returns The scanned directories, what they hold, the lockfiles found and the
 *   files they pin.
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
   * holds the same entries as its action list, shows the changes too. Every
   * locked action of a file is pinned by the same lockfiles, so the first one
   * lists the file.
   */
  let lockedFiles = new Map<string, LockedFile[]>()
  for (let action of scanResult.actions) {
    if (action.file !== undefined) {
      let paths = names.get(action.file)!
      let pinning = lockfiles.filter(lockfile =>
        paths.some(file => isLockedReference(lockfile, { ...action, file })),
      )
      if (pinning.length > 0) {
        action.locked = true
        if (!lockedFiles.has(action.file)) {
          lockedFiles.set(
            action.file,
            pinning.map(lockfile => ({
              workflows: findKeys(lockfile, paths),
              lockfile,
            })),
          )
        }
      }
    }
  }

  return {
    directories: directories.map(({ root, dir }) => resolve(root, dir)),
    lockedFiles,
    scanResult,
    lockfiles,
  }
}

/**
 * Find the keys of the tracked workflows under which a lockfile records what a
 * scanned file runs: the file itself when the lockfile tracks it as a workflow,
 * and the workflows that run it when it defines an action of the repository.
 *
 * The lockfile has to record the action under each workflow that runs it: a
 * workflow that runs it only through `./` would still check the remote actions
 * it runs against what the lockfile pinned before, once the others are
 * relocked. And none of those workflows may run remote actions through `./`
 * alone: a relock of it drops the pins of references it no longer runs itself,
 * which such an action may still run.
 *
 * Which actions the workflows run has to be known for that, so a lockfile that
 * cannot be read, or whose workflows cannot all be traced, has its own
 * workflows relocked for nothing either: one of them may run remote actions
 * through `./`.
 *
 * @param lockfile - Lockfile that pins what the file runs.
 * @param names - Names the file goes by, ending with its real path.
 * @returns The keys, as the lockfile names them, or null when there are none,
 *   when a workflow runs the file without the lockfile recording what it runs,
 *   when one of the workflows runs remote actions through `./` alone, or when
 *   the lockfile or what its workflows run cannot be read.
 */
function findKeys(
  lockfile: WorkflowLockfile,
  names: string[],
): string[] | null {
  let { reached, keys } = lockfile
  if (reached === null || keys === null) {
    return null
  }
  let runs = names.flatMap(name => [...(reached.get(name) ?? [])])
  if (runs.some(([, recorded]) => !recorded)) {
    return null
  }
  let recording = new Set([...names, ...runs.map(([workflow]) => workflow)])
  let local = reached
    .values()
    .some(definition =>
      definition
        .entries()
        .some(([workflow, recorded]) => !recorded && recording.has(workflow)),
    )
  if (local) {
    return null
  }
  let found = keys
    .entries()
    .filter(([, path]) => recording.has(path))
    .map(([key]) => key)
    .toArray()
  return found.length > 0 ? found : null
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
