import type { MultiselectState } from '../../../types/multiselect-state'

/**
 * Collect the values of the selected options of a multiselect prompt.
 *
 * @param state - State of the prompt.
 * @returns Values in the order of the list.
 */
export function getSelectedValues<Value>(
  state: MultiselectState<Value>,
): Value[] {
  return state.entries.flatMap((entry, index) =>
    entry.kind === 'option' && state.selected.has(index) ? [entry.value] : [],
  )
}
