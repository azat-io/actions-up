import { isAbsolute, join } from 'node:path'

import { GITHUB_DIRECTORY } from '../core/constants'

/**
 * Options for anchoring directory inputs at the repository root.
 */
interface AnchorDirectoryInputsOptions {
  /**
   * Raw --dir value(s), or undefined when the flag was not provided.
   */
  dir?: string[] | string

  /**
   * Repository root detected by walking up, or null when none was found.
   */
  root: string | null

  /**
   * Current working directory the CLI was invoked from.
   */
  cwd: string
}

/**
 * Anchors relative scan directories at the detected repository root.
 *
 * When the CLI runs from a nested subdirectory, the default `.github` and any
 * simple relative `--dir` values are resolved against the repository root
 * instead of the current directory. Absolute and parent-relative (`..`) values
 * are intentional and left untouched.
 *
 * @param options - Detected root, current directory, and raw --dir value(s).
 * @returns The directory input(s) to feed into resolveScanDirectories.
 */
export function anchorDirectoryInputs(
  options: AnchorDirectoryInputsOptions,
): undefined | string[] | string {
  let { root, cwd, dir } = options

  if (!root || root === cwd) {
    return dir
  }

  let inputs: string[] = []
  if (Array.isArray(dir)) {
    inputs.push(...dir)
  } else if (typeof dir === 'string') {
    inputs.push(dir)
  }
  if (inputs.length === 0) {
    inputs = ['.']
  }

  return inputs.map(value => {
    if (isAbsolute(value) || value.startsWith('..')) {
      return value
    }
    let joined = join(root, value)
    return joined === root ? join(root, GITHUB_DIRECTORY) : joined
  })
}
