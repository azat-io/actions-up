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

  it.each([
    ['a quantifier range', 'actions/setup-node-v{1,3}'],
    ['a character class', 'my-org/[a,b]-.*'],
    ['a group', '(my-org,other-org)/.*'],
  ])(
    'keeps a comma inside %s as part of the pattern',
    (_construct, pattern) => {
      expect(normalizePatternList([pattern])).toEqual([pattern])
    },
  )

  it('does not split on an escaped comma', () => {
    let pattern = String.raw`my-org\,beta`

    expect(normalizePatternList([pattern])).toEqual([pattern])
  })

  it('splits only on the commas between patterns', () => {
    let result = normalizePatternList(['my-org/.*, actions/setup-node-v{1,3}'])

    expect(result).toEqual(['my-org/.*', 'actions/setup-node-v{1,3}'])
  })

  it('keeps the order of repeated values', () => {
    let result = normalizePatternList(['x', 'y,z'])

    expect(result).toEqual(['x', 'y', 'z'])
  })
})
