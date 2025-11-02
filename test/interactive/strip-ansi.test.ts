import { describe, expect, it } from 'vitest'

import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('stripAnsi', () => {
  it('removes simple ANSI color codes', () => {
    /* Cspell:disable-next-line */
    let input = `\u001B[31mred\u001B[0m text`
    expect(stripAnsi(input)).toBe('red text')
  })

  it('keeps non-ANSI content intact', () => {
    let input = 'plain content'
    expect(stripAnsi(input)).toBe('plain content')
  })

  it('handles mixed content with multiple ANSI sequences', () => {
    /* Cspell:disable-next-line */
    let input = `pre \u001B[32mgreen\u001B[0m mid \u001B[1;31mbold-red\u001B[0m post`
    expect(stripAnsi(input)).toBe('pre green mid bold-red post')
  })

  it('keeps malformed escape sequence unchanged', () => {
    /* Cspell:disable-next-line */
    let input = `text \u001B[x tail`
    expect(stripAnsi(input)).toBe(`text \u001B[x tail`)
  })
})
