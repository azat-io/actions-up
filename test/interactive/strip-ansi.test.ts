import { describe, expect, it } from 'vitest'

import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('stripAnsi', () => {
  it('removes simple ANSI color codes', () => {
    /* Cspell:disable-next-line */
    let input = `\u{1B}[31mred\u{1B}[0m text`
    expect(stripAnsi(input)).toBe('red text')
  })

  it('keeps non-ANSI content intact', () => {
    let input = 'plain content'
    expect(stripAnsi(input)).toBe('plain content')
  })

  it('handles mixed content with multiple ANSI sequences', () => {
    /* Cspell:disable-next-line */
    let input = `pre \u{1B}[32mgreen\u{1B}[0m mid \u{1B}[1;31mbold-red\u{1B}[0m post`
    expect(stripAnsi(input)).toBe('pre green mid bold-red post')
  })

  it('keeps malformed escape sequence unchanged', () => {
    /* Cspell:disable-next-line */
    let input = `text \u{1B}[x tail`
    expect(stripAnsi(input)).toBe(`text \u{1B}[x tail`)
  })
})
