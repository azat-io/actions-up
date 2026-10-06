import { describe, expect, it } from 'vitest'

import { stripAnsi } from '../../../core/interactive/strip-ansi'

describe('stripAnsi', () => {
  it.each([
    {
      /* Cspell:disable-next-line */
      input: `\u{1B}[31mred\u{1B}[0m text`,
      description: 'a single color code',
      expected: 'red text',
    },
    {
      /* Cspell:disable-next-line */
      input: `pre \u{1B}[32mgreen\u{1B}[0m mid \u{1B}[1;31mbold-red\u{1B}[0m post`,
      description: 'several color codes, one with combined parameters',
      expected: 'pre green mid bold-red post',
    },
  ])('removes $description', ({ expected, input }) => {
    expect(stripAnsi(input)).toBe(expected)
  })

  it.each([
    { description: 'plain text', input: 'plain content' },
    {
      description: 'text whose square brackets start no escape code',
      input: 'build (matrix[0], [node 22])',
    },
  ])('keeps $description intact', ({ input }) => {
    expect(stripAnsi(input)).toBe(input)
  })

  it('keeps an escape sequence without parameters that is not a color code', () => {
    let input = `text \u{1B}[x tail`

    expect(stripAnsi(input)).toBe(input)
  })
})
