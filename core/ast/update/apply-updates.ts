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

        /** Matches `uses` key (optionally quoted for JSON-style YAML). */
        let usesKey = String.raw`['"]?\buses\b['"]?\s*:\s*`

        /**
         * Prefix captures context before `uses:`:
         *
         * - Start of line + whitespace + optional `-` (standard YAML)
         * - OR `{`, `[`, `,` + whitespace (JSON-style flow syntax).
         */
        let prefixPattern =
          String.raw`(?:^[^\S\n]*(?:-[^\S\n]*)?|[{\[,][^\S\n]*)` + usesKey

        /** Match `uses:` + action@version (quoted/unquoted, flow or block). */
        let pattern = new RegExp(
          String.raw`(?<prefix>${prefixPattern})` +
            /** Optional quote around the ref. */
            String.raw`(?<quote>['"]?)` +
            /** Action name before @. */
            String.raw`(?<name>${escapedName})@${escapedVersion}` +
            String.raw`\k<quote>` +
            /** Trailing delimiters/spaces after the ref. */
            String.raw`(?<after>[ \t\]}{,]*)` +
            /** Existing inline comment (if any). */
            String.raw`(?<comment>[^\S\r\n]*#[^\r\n]*)?`,
          'gm',
        )

        interface MatchGroups {
          comment?: string
          prefix: string
          quote: string
          after: string
          name: string
        }

        content = content.replace(pattern, (...captures) => {
          let [matched] = captures
          let offset = captures.at(-3) as number
          let source = captures.at(-2) as string
          let groups = captures.at(-1) as MatchGroups
          let nextLineBreak = source.indexOf('\n', offset + matched.length)
          let restOfLine =
            nextLineBreak === -1
              ? source.slice(offset + matched.length)
              : source.slice(offset + matched.length, nextLineBreak)

          /**
           * Avoid inserting a comment mid-line when more content follows.
           * Exception: when currentVersion is missing, trailing content may be
           * the original unparsed version suffix — allow comment in that case.
           */
          let hasTrailingContent = restOfLine.trim().length > 0
          let spacer = groups.after.endsWith(' ') ? '' : ' '
          let skipComment =
            hasTrailingContent && !groups.comment && escapedVersion !== ''
          let comment = skipComment ? '' : `${spacer}# ${update.latestVersion}`

          let action = `${groups.prefix}${groups.quote}${groups.name}`
          let version = `${update.latestSha}${groups.quote}${groups.after}${comment}`

          return `${action}@${version}`
        })
      }

      await writeFile(filePath, content, 'utf8')
    },
  )

  await Promise.all(filePromises)
}
