import type { Key } from 'node:readline'

import type { MultiselectEntry } from '../../../types/multiselect-entry'
import type { MultiselectState } from '../../../types/multiselect-state'

import { isFocusableEntry } from './is-focusable-entry'

/**
 * What a key does in the list.
 */
type Action =
  | 'toggleGroup'
  | 'toggleAll'
  | 'invert'
  | 'submit'
  | 'cancel'
  | 'toggle'
  | 'first'
  | 'last'
  | 'down'
  | 'up'

/**
 * What the keys do, by the names readline gives them. Shift and the Meta that
 * Esc pressed right before a key adds leave letters as they are, so `A` works
 * as `a` and Esc followed by `j` works as `j`.
 */
const ACTIONS = new Map<string, Action>([
  ['g', 'toggleGroup'],
  ['return', 'submit'],
  ['escape', 'cancel'],
  ['enter', 'submit'],
  ['space', 'toggle'],
  ['a', 'toggleAll'],
  ['home', 'first'],
  ['down', 'down'],
  ['i', 'invert'],
  ['end', 'last'],
  ['j', 'down'],
  ['up', 'up'],
  ['k', 'up'],
])

/**
 * Keys that move the focus whatever Ctrl or Meta are held with them, and that
 * the list does not use with Shift.
 */
const NAVIGATION_KEYS = new Set(['down', 'home', 'end', 'up'])

/**
 * Apply a key the user pressed to a multiselect prompt.
 *
 * The focus moves over group labels and the options that are not disabled,
 * wrapping around at both ends. Space toggles the focused option, or every
 * option of the focused group: they all get selected unless they all already
 * are. `a` does the same for the whole list, `i` inverts the selection, and `g`
 * toggles the group of the focused line. Enter submits; Esc and Ctrl+C cancel.
 *
 * @param state - State before the key.
 * @param key - The key, as readline reports it.
 * @returns State after the key, or null for a key the list does not use.
 */
export function reduceMultiselectKey<Value>(
  state: MultiselectState<Value>,
  key: Key,
): MultiselectState<Value> | null {
  let { selected, entries, focus } = state
  switch (getAction(key)) {
    case 'toggleGroup':
      return {
        ...state,
        selected: toggleOptions(
          selected,
          getGroupOptions(entries, findGroup(entries, focus)),
        ),
      }
    case 'toggleAll':
      return {
        ...state,
        selected: toggleOptions(selected, getSelectableOptions(entries)),
      }
    case 'invert':
      return {
        ...state,
        selected: new Set(
          getSelectableOptions(entries).filter(index => !selected.has(index)),
        ),
      }
    case 'submit':
      return { ...state, status: 'submitted' }
    case 'cancel':
      return { ...state, status: 'cancelled' }
    case 'toggle':
      return {
        ...state,
        selected: toggleOptions(
          selected,
          entries[focus]?.kind === 'group' ?
            getGroupOptions(entries, focus)
          : getSelectableOptions(entries, focus, focus + 1),
        ),
      }
    case 'first':
      return {
        ...state,
        focus: Math.max(entries.findIndex(isFocusableEntry), 0),
      }
    case 'last':
      return {
        ...state,
        focus: Math.max(entries.findLastIndex(isFocusableEntry), 0),
      }
    case 'down':
      return { ...state, focus: moveFocus(entries, focus, 1) }
    case 'up':
      return { ...state, focus: moveFocus(entries, focus, -1) }
    default:
      return null
  }
}

/**
 * Find the next line the focus can stop on, wrapping around at the ends of the
 * list.
 *
 * @param entries - Lines of the list.
 * @param from - Position of the focused line.
 * @param step - 1 to move down, -1 to move up.
 * @returns Position of the line to focus, or `from` when there is none.
 */
function moveFocus(
  entries: MultiselectEntry<unknown>[],
  from: number,
  step: -1 | 1,
): number {
  let count = entries.length
  for (let distance = 1; distance <= count; distance++) {
    let index = (((from + step * distance) % count) + count) % count
    if (isFocusableEntry(entries[index]!)) {
      return index
    }
  }
  return from
}

/**
 * Find out what a key does in the list.
 *
 * @param key - The key, as readline reports it.
 * @returns The action, or null for a key the list does not use.
 */
function getAction({
  shift = false,
  ctrl = false,
  name = '',
}: Key): Action | null {
  if (ctrl && name === 'c') {
    return 'cancel'
  }
  if (name === 'tab') {
    return shift ? 'up' : 'down'
  }
  if (NAVIGATION_KEYS.has(name) ? shift : ctrl) {
    return null
  }
  return ACTIONS.get(name) ?? null
}

/**
 * Select every option of a list, unless all of them are selected already, in
 * which case deselect them.
 *
 * @param selected - Positions of the selected options.
 * @param options - Positions of the options to toggle.
 * @returns Positions of the selected options after the toggle.
 */
function toggleOptions(
  selected: ReadonlySet<number>,
  options: number[],
): ReadonlySet<number> {
  let others = [...selected].filter(index => !options.includes(index))
  let isAllSelected = options.every(index => selected.has(index))
  return new Set(isAllSelected ? others : [...others, ...options])
}

/**
 * Positions of the options that can be selected between two positions.
 *
 * @param entries - Lines of the list.
 * @param start - First position to check.
 * @param end - Position after the last one to check.
 * @returns Positions of the options that are not disabled.
 */
function getSelectableOptions(
  entries: MultiselectEntry<unknown>[],
  start = 0,
  end = entries.length,
): number[] {
  return entries.flatMap((entry, index) =>
    (
      index >= start &&
      index < end &&
      entry.kind === 'option' &&
      !entry.disabled
    ) ?
      [index]
    : [],
  )
}

/**
 * Positions of the options of a group that can be selected: the options from
 * its label down to the next label.
 *
 * @param entries - Lines of the list.
 * @param group - Position of the group label, or -1 for the options above the
 *   first label.
 * @returns Positions of the options that are not disabled.
 */
function getGroupOptions(
  entries: MultiselectEntry<unknown>[],
  group: number,
): number[] {
  let next = entries.findIndex(
    (entry, index) => index > group && entry.kind === 'group',
  )
  return getSelectableOptions(
    entries,
    group + 1,
    next === -1 ? entries.length : next,
  )
}

/**
 * Find the group a line belongs to: the closest group label at or above it.
 *
 * @param entries - Lines of the list.
 * @param index - Position of the line.
 * @returns Position of the group label, or -1 above the first label.
 */
function findGroup(
  entries: MultiselectEntry<unknown>[],
  index: number,
): number {
  return entries.findLastIndex(
    (entry, position) => position <= index && entry.kind === 'group',
  )
}
