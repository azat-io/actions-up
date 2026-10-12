import type { Key } from 'node:readline'

import { describe, expect, it } from 'vitest'

import type { MultiselectEntry } from '../../../../types/multiselect-entry'
import type { MultiselectState } from '../../../../types/multiselect-state'

import { createMultiselectState } from '../../../../core/interactive/multiselect/create-multiselect-state'
import { reduceMultiselectKey } from '../../../../core/interactive/multiselect/reduce-multiselect-key'

/**
 * Two groups laid out like the list of updates: each starts with its label and
 * a column header, and a blank line separates them. The second group has a
 * disabled option between two others.
 *
 * @returns Lines of the list.
 */
function createEntries(): MultiselectEntry<string>[] {
  return [
    { message: 'a.yml', kind: 'group' },
    { kind: 'separator', message: 'Action' },
    option('one', { selected: true }),
    option('two'),
    { kind: 'separator', message: ' ' },
    { message: 'b.yml', kind: 'group' },
    { kind: 'separator', message: 'Action' },
    option('three'),
    option('four', { disabled: true }),
    option('five', { selected: true }),
  ]
}

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

/**
 * Press a key that the list handles.
 *
 * @param state - State before the key.
 * @param pressed - The key.
 * @returns State after the key.
 */
function press(
  state: MultiselectState<string>,
  pressed: Key,
): MultiselectState<string> {
  let next = reduceMultiselectKey(state, pressed)
  if (!next) {
    throw new Error(`The list rang the bell on ${pressed.name}`)
  }
  return next
}

/**
 * State of the list with the focus on a line.
 *
 * @param message - Text of the focused line.
 * @param entries - Lines of the list.
 * @returns The state.
 */
function focusOn(
  message: string,
  entries = createEntries(),
): MultiselectState<string> {
  let state = createMultiselectState(entries)
  let focus = entries.findIndex(entry => entry.message === message)
  return { ...state, focus }
}

/**
 * Values of the selected options, top to bottom.
 *
 * @param state - State of the list.
 * @returns Values in the order of the list.
 */
function selectedValues(state: MultiselectState<string>): string[] {
  return state.entries.flatMap((entry, index) =>
    entry.kind === 'option' && state.selected.has(index) ? [entry.value] : [],
  )
}

/**
 * Key the way readline reports it.
 *
 * @param name - What readline calls the key, such as `down`.
 * @param modifiers - Modifiers held with it, none by default.
 * @returns Key object.
 */
function key(name: undefined | string, modifiers: Partial<Key> = {}): Key {
  return { shift: false, ctrl: false, meta: false, name, ...modifiers }
}

/**
 * Text of the focused line.
 *
 * @param state - State of the list.
 * @returns Text of the line.
 */
function focused(state: MultiselectState<string>): string {
  return state.entries[state.focus]!.message
}

describe('reduceMultiselectKey', () => {
  describe('moving the focus', () => {
    it.each([
      { pressed: key('down'), description: 'Down' },
      { pressed: key('j'), description: 'j' },
      { pressed: key('j', { shift: true }), description: 'J' },
      { pressed: key('tab'), description: 'Tab' },
      { pressed: key('down', { ctrl: true }), description: 'Ctrl+Down' },
      { pressed: key('j', { meta: true }), description: 'Esc and j' },
    ])('moves down past the column header on $description', ({ pressed }) => {
      expect(focused(press(focusOn('a.yml'), pressed))).toBe('one')
    })

    it.each([
      { pressed: key('up'), description: 'Up' },
      { pressed: key('k'), description: 'k' },
      { pressed: key('k', { shift: true }), description: 'K' },
      { pressed: key('tab', { shift: true }), description: 'Shift+Tab' },
      { pressed: key('up', { ctrl: true }), description: 'Ctrl+Up' },
      { pressed: key('k', { meta: true }), description: 'Esc and k' },
    ])('moves up past a disabled option on $description', ({ pressed }) => {
      expect(focused(press(focusOn('five'), pressed))).toBe('three')
    })

    it.each([
      { from: 'two', to: 'b.yml' },
      { from: 'three', to: 'five' },
      { from: 'five', to: 'a.yml' },
    ])('moves down from $from to $to', ({ from, to }) => {
      expect(focused(press(focusOn(from), key('down')))).toBe(to)
    })

    it.each([
      { from: 'b.yml', to: 'two' },
      { from: 'one', to: 'a.yml' },
      { from: 'a.yml', to: 'five' },
    ])('moves up from $from to $to', ({ from, to }) => {
      expect(focused(press(focusOn(from), key('up')))).toBe(to)
    })

    it('keeps the focus where it is when no line can be focused', () => {
      let entries: MultiselectEntry<string>[] = [
        { kind: 'separator', message: 'Action' },
        option('one', { disabled: true }),
      ]

      expect(press(focusOn('Action', entries), key('down')).focus).toBe(0)
    })

    it('moves to the first line on Home', () => {
      expect(focused(press(focusOn('five'), key('home')))).toBe('a.yml')
    })

    it('moves to the last option that can be focused on End', () => {
      let entries = [...createEntries(), option('six', { disabled: true })]

      expect(focused(press(focusOn('a.yml', entries), key('end')))).toBe('five')
    })
  })

  describe('selecting', () => {
    it('toggles the focused option on Space', () => {
      let state = press(focusOn('two'), key('space'))

      expect(selectedValues(state)).toStrictEqual(['one', 'two', 'five'])
      expect(selectedValues(press(state, key('space')))).toStrictEqual([
        'one',
        'five',
      ])
    })

    it('selects every option of the focused group on Space unless all are selected', () => {
      let state = press(focusOn('b.yml'), key('space'))

      expect(selectedValues(state)).toStrictEqual(['one', 'three', 'five'])
      expect(selectedValues(press(state, key('space')))).toStrictEqual(['one'])
    })

    it('changes nothing on Space on a group without options to select', () => {
      let entries: MultiselectEntry<string>[] = [
        { message: 'a.yml', kind: 'group' },
        option('one', { disabled: true }),
      ]

      expect(
        selectedValues(press(focusOn('a.yml', entries), key('space'))),
      ).toStrictEqual([])
    })

    it.each([
      { pressed: key('a'), description: 'a' },
      { pressed: key('a', { shift: true }), description: 'A' },
    ])('selects every option, then none, on $description', ({ pressed }) => {
      let state = press(focusOn('a.yml'), pressed)

      expect(selectedValues(state)).toStrictEqual([
        'one',
        'two',
        'three',
        'five',
      ])
      expect(selectedValues(press(state, pressed))).toStrictEqual([])
    })

    it.each([
      { pressed: key('i'), description: 'i' },
      { pressed: key('i', { shift: true }), description: 'I' },
    ])('inverts the selection on $description', ({ pressed }) => {
      expect(selectedValues(press(focusOn('a.yml'), pressed))).toStrictEqual([
        'two',
        'three',
      ])
    })

    it.each([
      { pressed: key('g'), description: 'g' },
      { pressed: key('g', { shift: true }), description: 'G' },
    ])(
      'toggles the group of the focused option on $description',
      ({ pressed }) => {
        let state = press(focusOn('three'), pressed)

        expect(selectedValues(state)).toStrictEqual(['one', 'three', 'five'])
        expect(focused(state)).toBe('three')
      },
    )

    it('toggles the focused group on g', () => {
      expect(selectedValues(press(focusOn('a.yml'), key('g')))).toStrictEqual([
        'one',
        'two',
        'five',
      ])
    })

    it('leaves the state it got unchanged', () => {
      let state = focusOn('two')

      press(state, key('space'))

      expect(selectedValues(state)).toStrictEqual(['one', 'five'])
    })
  })

  describe('closing', () => {
    it.each([
      { pressed: key('return'), description: 'Enter' },
      { pressed: key('enter'), description: 'Ctrl+J' },
    ])('submits the selection on $description', ({ pressed }) => {
      expect(press(focusOn('two'), pressed).status).toBe('submitted')
    })

    it.each([
      { pressed: key('escape'), description: 'Esc' },
      { pressed: key('c', { ctrl: true }), description: 'Ctrl+C' },
    ])('cancels on $description', ({ pressed }) => {
      expect(press(focusOn('two'), pressed).status).toBe('cancelled')
    })
  })

  it.each([
    { pressed: key('left'), description: 'Left' },
    { pressed: key('right'), description: 'Right' },
    { description: 'a letter it does not use', pressed: key('x') },
    { description: 'a digit', pressed: key('1') },
    { pressed: key('pageup'), description: 'Page Up' },
    { pressed: key('pagedown'), description: 'Page Down' },
    { pressed: key('up', { shift: true }), description: 'Shift+Up' },
    { pressed: key('down', { shift: true }), description: 'Shift+Down' },
    { pressed: key('a', { ctrl: true }), description: 'Ctrl+A' },
    { pressed: key('e', { ctrl: true }), description: 'Ctrl+E' },
    { pressed: key('g', { ctrl: true }), description: 'Ctrl+G' },
    { pressed: key('l', { ctrl: true }), description: 'Ctrl+L' },
    { pressed: key('n', { ctrl: true }), description: 'Ctrl+N' },
    { pressed: key('d', { ctrl: true }), description: 'Ctrl+D' },
    { pressed: key('z', { ctrl: true }), description: 'Ctrl+Z' },
    { pressed: key('k', { ctrl: true }), description: 'Ctrl+K' },
    { pressed: key('backspace'), description: 'Backspace' },
    { pressed: key('delete'), description: 'Delete' },
    { description: 'the Clear key of a keypad', pressed: key('clear') },
    { description: 'a key without a name', pressed: key(undefined) },
  ])('rings the bell on $description', ({ pressed }) => {
    expect(reduceMultiselectKey(focusOn('two'), pressed)).toBeNull()
  })
})
