import { writeFile, readFile } from 'node:fs/promises'

import type { WrittenFile } from '../../types/written-file'

/**
 * Put rewritten files back the way they were, each only while it still holds
 * the text the updater wrote.
 *
 * A file changed since, by the user or by a tool, is left as it is, so no edit
 * made in the meantime is lost. So is a file that cannot be read, and one that
 * cannot be written back, whose error is printed with its path.
 *
 * @param files - Files the updater rewrote.
 * @returns Paths of the files put back, in the given order.
 */
export async function restoreWrittenFiles(
  files: WrittenFile[],
): Promise<string[]> {
  let restored = await Promise.all(files.map(restoreWrittenFile))
  return files.filter((_file, index) => restored[index]).map(({ path }) => path)
}

/**
 * Put one rewritten file back, while it still holds what the updater wrote,
 * byte for byte.
 *
 * @param file - File the updater rewrote.
 * @returns Whether it was put back.
 */
async function restoreWrittenFile({
  before,
  after,
  path,
}: WrittenFile): Promise<boolean> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return false
  }
  if (!bytes.equals(Buffer.from(after, 'utf8'))) {
    return false
  }
  try {
    await writeFile(path, before, 'utf8')
    return true
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    console.error(`Could not put back ${path}: ${message}`)
    return false
  }
}
