import { readFile } from 'node:fs/promises'

/**
 * Best-effort extraction of version number from an inline comment on the same
 * line as `uses:`. Expected shape after update is, for example: `uses:
 * actions/checkout@<sha> # v5.0.0`.
 *
 * Only used when the current reference is a SHA. Returns null if not found.
 *
 * @param filePath - Absolute path to the YAML file.
 * @param lineNumber - 1-based line number of the `uses:` key.
 * @param cache - Optional cache of file contents by path.
 * @returns Extracted version (e.g., `v5.0.0`) or null when not present.
 */
export async function readInlineVersionComment(
  filePath: undefined | string,
  lineNumber: undefined | number,
  cache?: Map<string, string>,
): Promise<string | null> {
  try {
    if (!filePath || !lineNumber || lineNumber <= 0) {
      return null
    }

    let content = cache?.get(filePath)
    if (content === undefined) {
      content = await readFile(filePath, 'utf8')
      if (cache) {
        cache.set(filePath, content)
      }
    }
    let lines = content.split('\n')
    let index = lineNumber - 1
    if (index < 0 || index >= lines.length) {
      return null
    }

    let line = lines[index]!
    let match = line.match(
      /#\s*(?<version>[Vv]?\d+(?:\.\d+){0,2}(?:[+-][\w\-.]+)?)/u,
    )
    if (match?.groups?.['version']) {
      return match.groups['version']
    }
  } catch {
    /** Ignore errors - simply fall back to SHA display. */
  }
  return null
}
