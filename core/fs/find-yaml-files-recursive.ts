import { readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { isYamlFile } from './is-yaml-file'

/**
 * Recursively finds all YAML files in a directory.
 *
 * @param directory - The absolute path to the directory to search.
 * @returns A promise that resolves to an array of absolute paths to YAML files.
 */
export async function findYamlFilesRecursive(
  directory: string,
): Promise<string[]> {
  let results: string[] = []
  let visited = new Set<string>()

  async function walk(current: string): Promise<void> {
    let info = await lstat(current)
    if (info.isSymbolicLink()) {
      return
    }

    if (visited.has(current)) {
      return
    }
    visited.add(current)

    let entries = await readdir(current)

    let promises = entries.map(async entry => {
      try {
        let fullPath = join(current, entry)

        let entryStat = await lstat(fullPath)

        if (entryStat.isSymbolicLink()) {
          return
        }

        if (entryStat.isDirectory()) {
          await walk(fullPath)
        } else if (entryStat.isFile() && isYamlFile(entry)) {
          results.push(fullPath)
        }
      } catch {
        /**
         * Skip inaccessible entries.
         */
      }
    })

    await Promise.all(promises)
  }

  await walk(directory)

  return results
}
