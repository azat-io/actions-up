import { readFile } from 'node:fs/promises'

/**
 * Determine whether a given file/line should be ignored based on inline comment
 * directives present in the file content.
 *
 * Supported directives (lowercase, exact match):
 *
 * - `actions-up-ignore-file`
 * - `actions-up-ignore-start` … `actions-up-ignore-end`
 * - `actions-up-ignore-next-line`
 * - `actions-up-ignore` (inline on the same line).
 *
 * Notes:
 *
 * - "next-line" applies strictly to the immediate next physical line.
 * - Block directives behave as a simple toggle; nested blocks are not supported.
 * - Optional text after a colon is ignored.
 * - If line is missing or <= 0, only file-level ignore applies.
 *
 * @param filePath - Path to the YAML file being processed.
 * @param line - One-based line number to check.
 * @returns Promise that resolves to true when the target should be ignored.
 */
export async function shouldIgnore(
  filePath: undefined | string,
  line: undefined | number,
): Promise<boolean> {
  if (!filePath) {
    return false
  }

  let content = await readFile(filePath, 'utf8')
  let lines = content.split('\n')

  for (let text of lines) {
    if (text.includes('actions-up-ignore-file')) {
      return true
    }
  }

  if (!line || line <= 0) {
    return false
  }

  let ignored = new Set<number>()
  let inBlock = false

  for (let [index, line_] of lines.entries()) {
    let text = line_
    let current = index + 1

    if (text.includes('actions-up-ignore-start')) {
      inBlock = true
    }

    if (inBlock) {
      ignored.add(current)
    }

    if (text.includes('actions-up-ignore-end')) {
      ignored.add(current)
      inBlock = false
    }

    if (text.includes('actions-up-ignore-next-line')) {
      ignored.add(current + 1)
    }

    if (
      text.includes('actions-up-ignore') &&
      !text.includes('actions-up-ignore-next-line') &&
      !text.includes('actions-up-ignore-start') &&
      !text.includes('actions-up-ignore-end') &&
      !text.includes('actions-up-ignore-file')
    ) {
      ignored.add(current)
    }
  }

  return ignored.has(line)
}
