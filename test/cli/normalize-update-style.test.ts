import { describe, expect, it } from 'vitest'

import { normalizeUpdateStyle } from '../../cli/normalize-update-style'

describe('normalizeUpdateStyle', () => {
  it('defaults to sha when no style is given', () => {
    let result = normalizeUpdateStyle(undefined)

    expect(result).toBe('sha')
  })

  it.each([
    { expected: 'preserve', input: 'preserve' },
    { expected: 'preserve', input: 'Preserve' },
    { expected: 'semver', input: 'semver' },
    { expected: 'sha', input: 'sha' },
    { expected: 'sha', input: 'SHA' },
  ])('accepts $input as $expected', ({ expected, input }) => {
    let result = normalizeUpdateStyle(input)

    expect(result).toBe(expected)
  })

  it('rejects an unknown style, echoing the value as given', () => {
    expect(() => normalizeUpdateStyle('Tag')).toThrow(
      'Invalid style "Tag". Expected "sha", "preserve" or "semver".',
    )
  })
})
