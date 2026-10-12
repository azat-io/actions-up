import { describe, expect, it, vi } from 'vitest'

import type { MultiselectEntry } from '../../../../types/multiselect-entry'
import type { MultiselectState } from '../../../../types/multiselect-state'

import { createMultiselectState } from '../../../../core/interactive/multiselect/create-multiselect-state'
import { renderMultiselect } from '../../../../core/interactive/multiselect/render-multiselect'
import { stripAnsi } from '../../../../core/interactive/strip-ansi'
import { colors } from '../../../../core/interactive/colors'

/**
 * The colors module decides at import time whether to color, from the
 * environment and the terminal. Colors turned on let every test check the same
 * output everywhere.
 */
vi.mock(import('../../../../core/interactive/colors'), async importOriginal => {
  let actual = await importOriginal()
  return { ...actual, colors: actual.createColors(true) }
})

/**
 * Question of the prompt, with colored keys as the update list has them.
 */
const MESSAGE = `Pick (Press ${colors.cyan('<space>')})`

/**
 * Line under the list.
 */
const FOOTER = 'Enter to submit.'

/**
 * Two groups laid out like the list of updates: each starts with its label and
 * a gray column header, and a blank line separates them. The second group has a
 * disabled option.
 *
 * @returns Lines of the list.
 */
function createEntries(): MultiselectEntry<string>[] {
  return [
    { message: colors.gray('a.yml'), kind: 'group' },
    { message: colors.gray('Action'), kind: 'separator' },
    option('one', { selected: true }),
    option('two', { selected: true }),
    { kind: 'separator', message: ' ' },
    { message: colors.gray('b.yml'), kind: 'group' },
    { message: colors.gray('Action'), kind: 'separator' },
    option('three'),
    option('four', { disabled: true }),
  ]
}

/**
 * Draw a state in a terminal large enough for the whole list.
 *
 * @param state - State of the prompt.
 * @param overrides - Options to change.
 * @returns What the renderer returns.
 */
function render(
  state: MultiselectState<string>,
  overrides: Partial<Parameters<typeof renderMultiselect<string>>[1]> = {},
): ReturnType<typeof renderMultiselect<string>> {
  return renderMultiselect(state, {
    summarize: values => (values.length > 0 ? `${values.length} picked` : ''),
    isWindowsConsole: false,
    message: MESSAGE,
    footer: FOOTER,
    columns: 80,
    rows: 40,
    start: 0,
    ...overrides,
  })
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
 * State of the list with the focus on a line.
 *
 * @param message - Visible text of the focused line.
 * @param entries - Lines of the list.
 * @returns The state.
 */
function focusOn(
  message: string,
  entries = createEntries(),
): MultiselectState<string> {
  let focus = entries.findIndex(entry => stripAnsi(entry.message) === message)
  return { ...createMultiselectState(entries), focus }
}

describe('renderMultiselect', () => {
  it('draws the question, every line of the list and the footer', () => {
    let { bgBlack, reset, cyan, gray, dim } = colors

    expect(render(createMultiselectState(createEntries())).text).toBe(
      [
        `${cyan('?')} ${MESSAGE} ${dim('…')} `,
        `${cyan('❯')} ${gray('●')} ${bgBlack(gray('a.yml'))}`,
        ` ${reset(' ')} ${gray('Action')}`,
        ` ${reset('   ●')} one`,
        ` ${reset('   ●')} two`,
        ` ${reset(' ')} ${gray(' ')}`,
        `  ${gray('○')} ${gray('b.yml')}`,
        ` ${reset(' ')} ${gray('Action')}`,
        ` ${reset('   ○')} three`,
        ` ${reset('   ○')} ${gray('four')} ${dim('(disabled)')}`,
        '',
        FOOTER,
      ].join('\n'),
    )
  })

  it('returns the question part of the first line', () => {
    let { cyan, dim } = colors

    expect(render(createMultiselectState(createEntries())).prompt).toBe(
      `${cyan('?')} ${MESSAGE} ${dim('…')} `,
    )
  })

  it('highlights the focused option, keeping its colors', () => {
    let { bgBlack, reset, cyan, gray } = colors
    let entries = createEntries()
    entries[3] = option(`t${gray('w')}o`, { selected: true })

    expect(render(focusOn('two', entries)).text.split('\n', 5)[4]).toBe(
      `${cyan('❯')}${reset('   ●')} ${bgBlack(`t${gray('w')}o`)}`,
    )
  })

  it('marks a group filled only when every one of its options is selected', () => {
    let entries = createEntries()
    entries.push(
      { message: 'c.yml', kind: 'group' },
      { message: 'd.yml', kind: 'group' },
      option('five', { selected: true }),
    )

    expect(
      stripAnsi(render(createMultiselectState(entries)).text)
        .split('\n')
        .filter(line => line.includes('.yml')),
    ).toStrictEqual(['❯ ● a.yml', '  ○ b.yml', '  ● c.yml', '  ● d.yml'])
  })

  it('makes the question bold when it has no colors of its own', () => {
    let { bold } = colors

    expect(
      render(createMultiselectState(createEntries()), { message: 'Pick' })
        .prompt,
    ).toContain(` ${bold('Pick')} `)
  })

  it('draws the Windows symbols in a Windows console', () => {
    let { dim } = colors
    let state = createMultiselectState(createEntries())

    expect(render(state, { isWindowsConsole: true }).prompt).toContain(
      dim('...'),
    )
    expect(
      stripAnsi(
        render({ ...state, status: 'submitted' }, { isWindowsConsole: true })
          .text,
      ),
    ).toMatch(/^√ /u)
    expect(
      stripAnsi(
        render({ ...state, status: 'cancelled' }, { isWindowsConsole: true })
          .text,
      ),
    ).toMatch(/^× /u)
  })

  describe('once closed', () => {
    it('draws only the question with the summary of the submitted selection', () => {
      let { reset, dim } = colors
      let state = createMultiselectState(createEntries())

      expect(render({ ...state, status: 'submitted' })).toStrictEqual({
        text: `${reset('✔')} ${MESSAGE} ${dim('·')} 2 picked`,
        prompt: `${reset('✔')} ${MESSAGE} ${dim('·')} `,
        start: 0,
      })
    })

    it('says that nothing was selected when the summary is empty', () => {
      let { magenta, reset, dim } = colors
      let state = createMultiselectState([option('one')])

      expect(render({ ...state, status: 'submitted' }).text).toBe(
        `${reset('✔')} ${MESSAGE} ${dim('·')} ${magenta('No items were selected')}`,
      )
    })

    it('says that nothing was selected when the prompt is cancelled', () => {
      let { magenta, dim } = colors
      let state = createMultiselectState(createEntries())

      expect(render({ ...state, status: 'cancelled' }).text).toBe(
        `${magenta('✖')} ${MESSAGE} ${dim('·')} ${magenta('No items were selected')}`,
      )
    })
  })

  describe('in a terminal too short for the whole list', () => {
    /**
     * Visible lines of the list in a frame.
     *
     * @param text - Text of the frame.
     * @returns Lines between the question and the blank line.
     */
    function listedLines(text: string): string[] {
      return stripAnsi(text).split('\n').slice(1, -2)
    }

    it('shows as many lines as fit with the question and the footer', () => {
      let frame = render(focusOn('a.yml'), { rows: 8 })

      expect(listedLines(frame.text)).toStrictEqual([
        '❯ ● a.yml',
        '   Action',
        '    ● one',
        '    ● two',
        ' '.repeat(4),
      ])
      expect(frame.start).toBe(0)
    })

    it('slides down just enough to show a focused line below it', () => {
      let frame = render(focusOn('b.yml'), { rows: 8 })

      expect(listedLines(frame.text)).toStrictEqual([
        '   Action',
        '    ● one',
        '    ● two',
        ' '.repeat(4),
        '❯ ○ b.yml',
      ])
      expect(frame.start).toBe(1)
    })

    it('keeps its position while the focused line stays in sight', () => {
      expect(render(focusOn('two'), { start: 2, rows: 8 }).start).toBe(2)
    })

    it('starts at a focused line above it', () => {
      expect(render(focusOn('one'), { start: 4, rows: 8 }).start).toBe(2)
    })

    it('fills the screen up to the last line of the list', () => {
      let frame = render(focusOn('three'), { start: 7, rows: 8 })

      expect(listedLines(frame.text)).toStrictEqual([
        ' '.repeat(4),
        '  ○ b.yml',
        '   Action',
        '❯   ○ three',
        '    ○ four (disabled)',
      ])
      expect(frame.start).toBe(4)
    })

    it('counts the rows of lines the terminal wraps', () => {
      let entries = createEntries()
      entries[3] = option('x'.repeat(30), { selected: true })

      expect(
        listedLines(
          render(focusOn('a.yml', entries), { columns: 20, rows: 9 }).text,
        ),
      ).toStrictEqual([
        '❯ ● a.yml',
        '   Action',
        '    ● one',
        `    ● ${'x'.repeat(30)}`,
      ])
    })

    it('shows the focused line even when nothing else fits', () => {
      let frame = render(focusOn('three'), { rows: 2 })

      expect(listedLines(frame.text)).toStrictEqual(['❯   ○ three'])
      expect(frame.start).toBe(7)
    })

    it('shows the whole list again once it fits', () => {
      expect(render(focusOn('three'), { start: 5 }).start).toBe(0)
    })
  })
})
