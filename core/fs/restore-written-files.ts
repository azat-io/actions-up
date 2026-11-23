import { writeFile, readFile } from 'node:fs/promises'

import type { WrittenFile } from '../../types/written-file'

/**
 * Put rewritten files back the way they were, each only while it still holds
 * the text the updater wrote.
 *
 * A file changed since, by the user or by a tool, is left as it is, so no edit
 * made in the meantime is lost. So is a file that cannot be read. A file that
 * cannot be written back is reported with the error, since the write may have
 * failed after it emptied the file.
 *
 * @param files - Files the updater rewrote.
 * @returns Paths of the files put back, in the given order, and the files that
 *   could not be written back, each with the error.
 */
export async function restoreWrittenFiles(files: WrittenFile[]): Promise<{
  failed: Map<string, string>
  restored: string[]
}> {
  let outcomes = await Promise.all(files.map(restoreWrittenFile))
  return {
    failed: new Map(
      files.flatMap(({ path }, index) => {
        let outcome = outcomes[index]
        return typeof outcome === 'object' ?
            [[path, outcome.error] as const]
          : []
      }),
    ),
    restored: files
      .filter((_file, index) => outcomes[index] === 'restored')
      .map(({ path }) => path),
  }
}

/**
 * Put one rewritten file back, while it still holds what the updater wrote,
 * byte for byte.
 *
 * @param file - File the updater rewrote.
 * @returns Whether it was put back or left unchanged, or the error writing it
 *   back failed with.
 */
async function restoreWrittenFile({
  before,
  after,
  path,
}: WrittenFile): Promise<{ error: string } | 'unchanged' | 'restored'> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return 'unchanged'
  }
  if (!bytes.equals(Buffer.from(after, 'utf8'))) {
    return 'unchanged'
  }
  try {
    await writeFile(path, before, 'utf8')
    return 'restored'
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
