import { writeFile, readFile } from 'node:fs/promises'

import type { ActionUpdate } from '../../../types/action-update'

/**
 * Apply updates using SHA with version in comment for readability.
 *
 * @param updates - Array of updates to apply.
 */
export async function applyUpdates(updates: ActionUpdate[]): Promise<void> {
  let updatesByFile = new Map<string, ActionUpdate[]>()

  for (let update of updates) {
    let { file } = update.action
    if (!file) {
      continue
    }

    let fileUpdates = updatesByFile.get(file) ?? []
    fileUpdates.push(update)
    updatesByFile.set(file, fileUpdates)
  }

  let filePromises = [...updatesByFile.entries()].map(
    async ([filePath, fileUpdates]) => {
      let content = await readFile(filePath, 'utf8')

      for (let update of fileUpdates) {
        if (!update.latestSha) {
          continue
        }

        function escapeRegExp(string_: string): string {
          return string_.replaceAll(/[$()*+\-./?[\\\]^{|}]/gu, String.raw`\$&`)
        }

        let escapedName = escapeRegExp(update.action.name)
        let escapedVersion = update.currentVersion
          ? escapeRegExp(update.currentVersion)
          : ''

        if (escapedName.includes('\n') || escapedName.includes('\r')) {
          console.error(`Invalid action name: ${update.action.name}`)
          continue
        }

        if (
          escapedVersion &&
          (escapedVersion.includes('\n') || escapedVersion.includes('\r'))
        ) {
          console.error(`Invalid version: ${update.currentVersion}`)
          continue
        }

        if (!/^[\da-f]{40}$/iu.test(update.latestSha)) {
          console.error(`Invalid SHA format: ${update.latestSha}`)
          continue
        }

        let boundary = escapedVersion ? String.raw`(?=[^\S\r\n]|$|#)` : ''

        let pattern = new RegExp(
          `(^\\s*-?\\s*uses:\\s*)(['"]?)(${escapedName})@${escapedVersion}\\2${boundary}([^\\S\\r\\n]*#[^\\r\\n]*)?`,
          'gm',
        )

        let replacement = `$1$2$3@${update.latestSha}$2 # ${update.latestVersion}`

        content = content.replace(pattern, replacement)
      }

      await writeFile(filePath, content, 'utf8')
    },
  )

  await Promise.all(filePromises)
}
