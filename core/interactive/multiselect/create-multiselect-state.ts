import type { MultiselectEntry } from '../../../types/multiselect-entry'
import type { MultiselectState } from '../../../types/multiselect-state'

import { isFocusableEntry } from './is-focusable-entry'

/**
 * Create the state of a multiselect prompt as it opens: the focus on the first
 * line that can be focused, and the options selected at the start selected,
 * unless they are disabled.
 *
 * @param entries - Lines of the list, top to bottom.
 * @returns State of the prompt.
 */
export function createMultiselectState<Value>(
  entries: MultiselectEntry<Value>[],
): MultiselectState<Value> {
  let selected = new Set(
    entries.flatMap((entry, index) =>
      entry.kind === 'option' && entry.selected && !entry.disabled ?
        [index]
      : [],
    ),
  )
  return {
    focus: Math.max(entries.findIndex(isFocusableEntry), 0),
    status: 'pending',
    selected,
    entries,
  }
}
