import { describe, expect, it } from 'vitest'

import type { MultiselectEntry } from '../../../../types/multiselect-entry'

import { createMultiselectState } from '../../../../core/interactive/multiselect/create-multiselect-state'

/**
 * Option of the list whose value is its text.
 *
 * @param message - Text of the option.
 * @param flags - Whether it is selected at the start and whether it is
 *   disabled.
 * @returns Line of the list.
 */
function option(
  message: string,
  flags: { selected?: boolean; disabled?: boolean } = {},
): MultiselectEntry<string> {
  return {
    disabled: flags.disabled ?? false,
    selected: flags.selected ?? false,
    kind: 'option',
    value: message,
    message,
  }
}

describe('createMultiselectState', () => {
  it('focuses the first line that can be focused', () => {
    let entries: MultiselectEntry<string>[] = [
      { kind: 'separator', message: 'Action' },
      option('one', { disabled: true }),
      option('two'),
    ]

    expect(createMultiselectState(entries).focus).toBe(2)
  })

  it('selects the options selected at the start, unless they are disabled', () => {
    let state = createMultiselectState([
      { message: 'a.yml', kind: 'group' },
      option('one', { selected: true }),
      option('two'),
      option('three', { disabled: true, selected: true }),
    ])

    expect([...state.selected]).toStrictEqual([1])
    expect(state.status).toBe('pending')
  })
})
