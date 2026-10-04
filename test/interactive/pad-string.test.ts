import { describe, expect, it } from 'vitest'

import { padString } from '../../core/interactive/pad-string'

describe('padString', () => {
  it('pads a string with spaces up to the target length', () => {
    expect(padString('abc', 5)).toBe('abc  ')
  })

  it.each([
    { role: 'longer than', length: 3 },
    { role: 'exactly as long as', length: 6 },
  ])('returns a string $role the target length unchanged', ({ length }) => {
    expect(padString('abcdef', length)).toBe('abcdef')
  })

  it('measures a colored string by its visible text and keeps its color codes', () => {
    let colored = `\u{1B}[32mab\u{1B}[0m`

    expect(padString(colored, 5)).toBe(`${colored}   `)
  })
})
