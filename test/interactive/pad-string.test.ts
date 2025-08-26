import { describe, expect, it } from 'vitest'

import { padString } from '../../core/interactive/pad-string'
import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('padString', () => {
  it('pads to the specified minimum length', () => {
    let result = padString('abc', 5)
    expect(result).toBe('abc  ')
  })

  it('returns original string when already long enough', () => {
    expect(padString('abcdef', 3)).toBe('abcdef')
    expect(padString('abcdef', 6)).toBe('abcdef')
  })

  it('computes length ignoring ANSI and pads accordingly', () => {
    let colored = `\u001B[32mab\u001B[0m`
    let padded = padString(colored, 5)
    expect(stripAnsi(padded)).toBe('ab   ')
  })
})
