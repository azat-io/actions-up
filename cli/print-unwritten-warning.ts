import { colors } from '../core/interactive/colors'

/**
 * Prints a notice for the entries the writer was asked to apply but could not.
 *
 * The notice goes to stderr, since the run did not do everything it announced.
 * An entry is usually left out because its file changed since the scan; the
 * writer explains any other reason itself.
 *
 * @param unwritten - Entries that were selected for writing but not written.
 * @param requested - Number of entries the writer was asked to apply.
 */
export function printUnwrittenWarning(
  unwritten: {
    action: {
      version?: string | null
      line?: number
      file?: string
      uses?: string
      name: string
    }
    currentVersion: string | null
  }[],
  requested: number,
): void {
  if (unwritten.length === 0) {
    return
  }

  let pluralRules = new Intl.PluralRules('en-US', { type: 'cardinal' })
  let entryNoun = pluralRules.select(requested) === 'one' ? 'entry' : 'entries'

  console.error(
    colors.yellow(
      `\n⚠️ Could not write ${unwritten.length} of ${requested} ${entryNoun}:`,
    ),
  )
  for (let update of unwritten) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    let { file, line } = update.action
    let location = file && line ? ` (${file}:${line})` : ''
    console.error(colors.yellow(`   • ${identifier}${location}`))
  }
}
