import type { MultiselectEntry } from '../../../types/multiselect-entry'

/**
 * Check whether the focus can stop on a line of a multiselect list: a group
 * label or an option that is not disabled.
 *
 * @param entry - Line of the list.
 * @returns True when the line can be focused.
 */
export function isFocusableEntry(entry: MultiselectEntry<unknown>): boolean {
  return entry.kind === 'group' || (entry.kind === 'option' && !entry.disabled)
}
