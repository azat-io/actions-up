import { describe, expect, it } from 'vitest'

import { normalizePatternList } from '../../cli/normalize-pattern-list'

describe('normalizePatternList', () => {
  it('returns an empty list when no patterns are given', () => {
    expect(normalizePatternList(undefined)).toEqual([])
    expect(normalizePatternList([])).toEqual([])
  })

  it('splits comma-separated values, trims them and drops empty entries', () => {
    let result = normalizePatternList(['a, b', ' ', 'c,'])

    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('keeps the order of repeated values', () => {
    let result = normalizePatternList(['x', 'y,z'])

    expect(result).toEqual(['x', 'y', 'z'])
  })
})
