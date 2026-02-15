import { isAbsolute, basename, relative, dirname, resolve } from 'node:path'

import { GITHUB_DIRECTORY } from '../core/constants'

/** Options for resolving scan directories from CLI flags. */
interface ResolveScanDirectoriesOptions {
  dir?: string[] | string
  recursive?: boolean
  cwd: string
}

/** Resolved directory with root and relative directory. */
interface ResolvedDirectory {
  root: string
  dir: string
}

/**
 * Resolve directories to scan from CLI options.
 *
 * Defaults:
 *
 * - Non-recursive mode: `.github`
 * - Recursive mode without --dir: `.`.
 *
 * @param options - CLI options used to compute scan directories.
 * @param options.cwd - Current working directory.
 * @param options.dir - Optional directory flag value(s).
 * @param options.recursive - Whether recursive mode is enabled.
 * @returns Unique resolved directories.
 */
export function resolveScanDirectories(
  options: ResolveScanDirectoriesOptions,
): ResolvedDirectory[] {
  let { recursive, cwd, dir } = options

  let rawDirectories: string[] = []
  if (Array.isArray(dir)) {
    rawDirectories.push(...dir)
  } else if (typeof dir === 'string') {
    rawDirectories.push(dir)
  } else if (recursive) {
    rawDirectories.push('.')
  } else {
    rawDirectories.push(GITHUB_DIRECTORY)
  }

  let seen = new Set<string>()
  let results: ResolvedDirectory[] = []

  for (let value of rawDirectories) {
    let absolute = resolve(cwd, value)
    let relativePath = relative(cwd, absolute)
    let isOutside =
      relativePath.startsWith('..') ||
      isAbsolute(relativePath) ||
      resolve(cwd, relativePath) !== absolute

    let entry: ResolvedDirectory
    if (recursive) {
      entry = { root: absolute, dir: '.' }
    } else if (isOutside) {
      entry = { dir: basename(absolute), root: dirname(absolute) }
    } else {
      entry = { dir: relativePath || GITHUB_DIRECTORY, root: cwd }
    }

    let key = `${entry.root}\0${entry.dir}`
    if (!seen.has(key)) {
      seen.add(key)
      results.push(entry)
    }
  }

  return results
}
