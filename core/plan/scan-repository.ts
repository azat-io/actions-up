import { resolve } from 'node:path'

import type { ScanResult } from '../../types/scan-result'

import { resolveScanDirectories } from './resolve-scan-directories'
import { anchorDirectoryInputs } from './anchor-directory-inputs'
import { findRepositoryRoot } from '../fs/find-repository-root'
import { scanGitHubActions } from '../scan-github-actions'
import { mergeScanResults } from './merge-scan-results'
import { scanRecursive } from '../scan-recursive'

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
 * Everything a repository scan found.
 */
interface RepositoryScan {
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
 * Find the workflows and actions of a repository, the way `--dir` and
 * `--recursive` describe.
 *
 * Without `--recursive`, a directory is resolved against the root of the
 * repository the working directory belongs to.
 *
 * @param options - Where to look.
 * @returns The scanned directories and what they hold.
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

  return {
    directories: directories.map(({ root, dir }) => resolve(root, dir)),
    scanResult: mergeScanResults(scanResults),
  }
}
