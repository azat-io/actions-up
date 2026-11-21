/**
 * A line that sets `uses`, as a step or a job writes it, with the reference it
 * names, quoted or not, and maybe a comment after it.
 */
const USES_LINE =
  /^\s*(?:-\s+)?uses\s*:\s*(?<quote>["']?)(?<value>[^\s"#']+)\k<quote>(?:[\t ]+#[^\r]*|[\t ]*)\r?$/u

/**
 * Tell whether a written file holds what gh-actions-lock writes when it renames
 * a repository that moved, and nothing else.
 *
 * Such a relock rewrites only the `uses:` line of the repository, which then
 * names the same reference under the new name of the repository, without the
 * comment of the line and with an LF line break. So each line that differs from
 * the written text has to be a `uses:` line that names the reference it named
 * before, of another repository, and the lockfile on disk has to pin it. Any
 * other change, as when something else edits the file while the lockfile is
 * regenerated, may leave the lockfile not matching the file.
 *
 * @param written - Text written to the file.
 * @param current - Text the file holds now.
 * @param isPinned - Whether the lockfile on disk pins a key, `owner/repo@ref`
 *   with the repository in lower case, for every workflow that runs the file.
 * @returns True when every changed line renames the repository of a reference
 *   the lockfile pins under the new name.
 */
export function isRenameRewrite(
  written: string,
  current: string,
  isPinned: (key: string) => boolean,
): boolean {
  let writtenLines = written.split('\n')
  let currentLines = current.split('\n')
  return (
    writtenLines.length === currentLines.length &&
    writtenLines.every((line, index) => {
      let now = currentLines[index]!
      if (line === now) {
        return true
      }
      let before = readKey(line)
      let after = readKey(now)
      return (
        before !== null &&
        after !== null &&
        before.reference === after.reference &&
        before.repository !== after.repository &&
        isPinned(`${after.repository}@${after.reference}`)
      )
    })
  )
}

/**
 * Read the repository and the reference a `uses:` line names.
 *
 * @param line - Line of the file.
 * @returns The repository, `owner/repo` in lower case, and the reference after
 *   `@`, or null when the line sets no `uses` or names no reference of a
 *   repository.
 */
function readKey(
  line: string,
): { repository: string; reference: string } | null {
  let { value = '' } = USES_LINE.exec(line)?.groups ?? {}
  let at = value.indexOf('@')
  let [owner, repository] = value.slice(0, Math.max(at, 0)).split('/', 2)
  return owner && repository ?
      {
        repository: `${owner}/${repository}`.toLowerCase(),
        reference: value.slice(at + 1),
      }
    : null
}
