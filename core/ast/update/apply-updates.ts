// Core/ast/apply-updates.ts

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

        let escapedName = update.action.name.replaceAll(
          /[$()*+.?[\\\]^{|}]/gu,
          String.raw`\$&`,
        )

        let escapedVersion = update.currentVersion?.replaceAll(
          /[$()*+.?[\\\]^{|}]/gu,
          String.raw`\$&`,
        )

        let pattern = new RegExp(
          String.raw`(^\s*-?\s*uses:\s*)(['"]?)(${escapedName})@${escapedVersion}\2(\s*#[^\n]*)?`,
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
