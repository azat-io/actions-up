import { colors } from '../core/interactive/colors'

/**
 * Prints why a workflow lockfile was not regenerated as checked, and what
 * became of the updated files.
 *
 * The notice goes to stderr and is printed even with `--quiet`, since the run
 * did not do everything it announced. Files that keep their updates may no
 * longer match the lockfile, so the notice then ends with the command that
 * regenerates it, unless that command would pin the same again.
 *
 * @param notice - What happened.
 * @param notice.heading - What went wrong, in one line.
 * @param notice.details - Findings or references that explain it.
 * @param notice.restored - Files put back the way they were, as shown to the
 *   user.
 * @param notice.unrestored - Files that could not be written back, each with
 *   the error, as shown to the user; the write may have left them cut short.
 * @param notice.left - Files that keep their updates, as shown to the user.
 * @param notice.command - Command that regenerates the lockfile, run from the
 *   working directory, null when running it would pin the same again.
 */
export function printRelockNotice(notice: {
  command: string | null
  unrestored: string[]
  restored: string[]
  details: string[]
  heading: string
  left: string[]
}): void {
  printList(`\n⚠️ ${notice.heading}`, notice.details)

  if (notice.restored.length > 0) {
    printList(
      `   Restored ${countFiles(notice.restored.length)} to match the lockfile again:`,
      notice.restored,
    )
  }

  if (notice.unrestored.length > 0) {
    printList(
      `   Could not put back ${countFiles(notice.unrestored.length)}, which may now be cut short; check with git diff:`,
      notice.unrestored,
    )
  }

  if (notice.left.length > 0) {
    let instruction =
      notice.command === null ? '' : '; run this to regenerate the lockfile'
    printList(
      `   Kept the updates in ${countFiles(notice.left.length)}${instruction}:`,
      notice.left,
    )
    if (notice.command !== null) {
      console.error(colors.gray(`   ${notice.command}`))
    }
  }
}

/**
 * Count files in words.
 *
 * @param count - Number of files.
 * @returns The count with the noun in the matching form.
 */
function countFiles(count: number): string {
  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  return `${count} ${pluralRules.select(count) === 'one' ? 'file' : 'files'}`
}

/**
 * Print a line followed by a bulleted list.
 *
 * @param heading - Line before the list.
 * @param items - Lines of the list.
 */
function printList(heading: string, items: string[]): void {
  console.error(colors.yellow(heading))
  for (let item of items) {
    console.error(colors.yellow(`   • ${item}`))
  }
}
