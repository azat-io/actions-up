import { relative, resolve } from 'node:path'

import { GITHUB_DIRECTORY } from '../core/constants'

/** Options for resolving scan directories from CLI flags. */
interface ResolveScanDirectoriesOptions {
  dir?: string[] | string
  recursive?: boolean
  cwd: string
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
 * @returns Unique normalized directories relative to `cwd`.
 */
export function resolveScanDirectories(
  options: ResolveScanDirectoriesOptions,
): string[] {
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

  return [
    ...new Set(
      rawDirectories.map(value => relative(cwd, resolve(cwd, value)) || '.'),
    ),
  ]
}
