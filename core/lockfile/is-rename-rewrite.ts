/**
 * A `uses` value on a line, with the text around it.
 */
interface Use {
  /**
   * Repository the value names, `owner/repo`, in lower case.
   */
  repository: string

  /**
   * Rest of the value after the repository: the path of an action in a
   * subdirectory, if any, then `@` and the reference.
   */
  rest: string

  /**
   * Text after the value, before a comment: a closing quote, more of the flow
   * mapping and the brackets that close it.
   */
  tail: string

  /**
   * Text before the value: the key, a tag and an opening quote.
   */
  head: string
}

/**
 * A line that sets `uses`, as a step writes it in block or flow style: the key,
 * quoted or not, starts the line, follows `- `, or follows `{` or `,` in a flow
 * mapping. Its value, maybe tagged as a string and quoted, may be followed by
 * more of the flow mapping, without quotes or `#`, by the brackets that close
 * it and by a comment.
 */
const USES_LINE =
  /^(?<head>(?:[^\r]*[,{][\t ]*|[\t ]*-[\t ]+|[\t ]*)(?<key>["']?)uses\k<key>[\t ]*:[\t ]*(?:!!str[\t ]+)?(?<quote>["']?))(?<value>[^\s"#',[\]{}]+)(?<tail>\k<quote>(?:[\t ]*[,\]}](?:[\t ]*[^\s"#'])*)?)(?:[\t ]+#[^\r]*|[\t ]*)\r?$/u

/**
 * Find the repositories a written file now names under a new name, as
 * gh-actions-lock renames a repository that moved: each line that differs from
 * the written text only in the repository a `uses` value names, whatever else
 * changed in the file.
 *
 * @param written - Text written to the file.
 * @param current - Text the file holds now.
 * @returns The key each renamed reference was written under, `owner/repo@ref`
 *   with the repository in lower case, mapped to its key under the new name;
 *   none when lines were added or removed.
 */
export function findRenames(
  written: string,
  current: string,
): Map<string, string> {
  return new Map(
    (pairChangedLines(written, current) ?? []).flatMap(
      ([line, now]): [string, string][] => {
        let rename = readRename(line, now)
        return rename ? [[rename.from, rename.to]] : []
      },
    ),
  )
}

/**
 * Tell whether a written file holds what gh-actions-lock writes when it renames
 * a repository that moved, and nothing else.
 *
 * Such a relock rewrites only the `uses` value of the repository, in place, so
 * that it names the same reference under the new name of the repository. The
 * text before the value stays as written, and so does the text after it, but
 * for the comment of the line, which the relock cuts off along with a CR before
 * the line break. So each line that differs from the written text has to set
 * `uses` the way the written line did, to the reference it named before, of
 * another repository, and the lockfile on disk has to pin it. Any other change,
 * as when something else edits the file while the lockfile is regenerated, may
 * leave the lockfile not matching the file. A name that changes only in case is
 * such a change too, as gh-actions-lock takes it for the same repository.
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
  return (
    pairChangedLines(written, current)?.every(([line, now]) => {
      let rename = readRename(line, now)
      return rename !== null && isPinned(rename.to)
    }) ?? false
  )
}

/**
 * Read the rename of a repository from a written line and the line that took
 * its place.
 *
 * @param line - Written line.
 * @param now - Line that took its place.
 * @returns The key the written line names, `owner/repo@ref` with the repository
 *   in lower case, and the key the line names now, or null when the line does
 *   not set `uses` to the same reference of another repository the way the
 *   written line did.
 */
function readRename(
  line: string,
  now: string,
): { from: string; to: string } | null {
  let before = readUse(line)
  let after = readUse(now)
  if (
    before === null ||
    after === null ||
    before.repository === after.repository ||
    before.rest !== after.rest ||
    before.head !== after.head ||
    before.tail !== after.tail
  ) {
    return null
  }
  let reference = before.rest.slice(before.rest.indexOf('@'))
  return {
    from: `${before.repository}${reference}`,
    to: `${after.repository}${reference}`,
  }
}

/**
 * Read the `uses` value of a line, with the text around it.
 *
 * @param line - Line of the file.
 * @returns The value and the text around it, or null when the line sets no
 *   `uses` or names no reference of a repository.
 */
function readUse(line: string): null | Use {
  let { value = '', head = '', tail = '' } = USES_LINE.exec(line)?.groups ?? {}
  let [owner, repository] = value
    .slice(0, Math.max(value.indexOf('@'), 0))
    .split('/', 2)
  return owner && repository ?
      {
        rest: value.slice(owner.length + repository.length + 1),
        repository: `${owner}/${repository}`.toLowerCase(),
        head,
        tail,
      }
    : null
}

/**
 * Pair each line of a written file that the file holds no longer with the line
 * that took its place.
 *
 * @param written - Text written to the file.
 * @param current - Text the file holds now.
 * @returns Each changed line with the line that took its place, in order, or
 *   null when lines were added or removed.
 */
function pairChangedLines(
  written: string,
  current: string,
): [string, string][] | null {
  let writtenLines = written.split('\n')
  let currentLines = current.split('\n')
  return writtenLines.length === currentLines.length ?
      writtenLines.flatMap((line, index): [string, string][] => {
        let now = currentLines[index]!
        return line === now ? [] : [[line, now]]
      })
    : null
}
