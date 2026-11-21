import { realpath } from 'node:fs/promises'

/**
 * Resolve the symbolic links of a path.
 *
 * @param path - Absolute path.
 * @returns Real path, or the path as given when it cannot be resolved.
 */
export async function toRealPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}
