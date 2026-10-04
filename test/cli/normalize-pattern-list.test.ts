import { describe, expect, it } from 'vitest'

import { normalizePatternList } from '../../cli/normalize-pattern-list'

describe('normalizePatternList', () => {
  it.each([
    { input: undefined, given: 'no flag' },
    { given: 'an empty list', input: [] },
  ])('returns an empty list for $given', ({ input }) => {
    expect(normalizePatternList(input)).toEqual([])
  })

  it('splits comma-separated values, trims them and drops empty entries', () => {
    let result = normalizePatternList(['a, b', ' ', 'c,'])

    expect(result).toEqual(['a', 'b', 'c'])
  })

  it.each([
    {
      pattern: 'actions/setup-node-v{1,3}',
      where: 'inside a quantifier range',
    },
    { where: 'inside a character class', pattern: 'my-org/[a,b]-.*' },
    { pattern: '(my-org,other-org)/.*', where: 'inside a group' },
    { pattern: String.raw`my-org\,beta`, where: 'that is escaped' },
  ])(
    'keeps a comma $where as part of the pattern and splits on the next one',
    ({ pattern }) => {
      let result = normalizePatternList([`${pattern},next-org/.*`])

      expect(result).toEqual([pattern, 'next-org/.*'])
    },
  )

  it('splits only on the commas between patterns', () => {
    let result = normalizePatternList(['my-org/.*, actions/setup-node-v{1,3}'])

    expect(result).toEqual(['my-org/.*', 'actions/setup-node-v{1,3}'])
  })

  it('keeps the order of repeated values', () => {
    let result = normalizePatternList(['x', 'y,z'])

    expect(result).toEqual(['x', 'y', 'z'])
  })
})
