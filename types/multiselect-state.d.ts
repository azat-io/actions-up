import type { MultiselectEntry } from './multiselect-entry'

/**
 * State of a multiselect prompt.
 */
export interface MultiselectState<Value> {
  /**
   * Whether the user is still choosing, has submitted the selection, or has
   * cancelled the prompt.
   */
  status: 'cancelled' | 'submitted' | 'pending'

  /**
   * Lines of the list, top to bottom.
   */
  entries: MultiselectEntry<Value>[]

  /**
   * Positions of the selected options in `entries`.
   */
  selected: ReadonlySet<number>

  /**
   * Position of the focused line in `entries`.
   */
  focus: number
}
