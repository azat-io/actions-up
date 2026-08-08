import { describe, expect, it } from 'vitest'

import { compareSha } from '../../core/versions/compare-sha'

describe('compareSha', () => {
  it('returns true for identical full SHAs', () => {
    let sha = '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'
    expect(compareSha(sha, sha)).toBeTruthy()
  })

  it('returns true when short SHA matches long SHA prefix', () => {
    expect(
      compareSha('3b1f9d7', '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'),
    ).toBeTruthy()
  })

  it('returns false when SHAs differ', () => {
    expect(
      compareSha(
        '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2',
        'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
      ),
    ).toBeFalsy()
  })

  it('returns false when common prefix is shorter than 7 characters', () => {
    expect(compareSha('3b1f9d', '3b1f9d770a89ffb6bbcf07a1c78a6f2c')).toBeFalsy()
  })

  it('ignores case differences', () => {
    expect(
      compareSha('3B1F9D7', '3b1f9d770a89ffb6bbcf07a1c78a6f2c'),
    ).toBeTruthy()
  })

  it('strips leading v prefix before comparing', () => {
    expect(
      compareSha('v3b1f9d7', '3b1f9d770a89ffb6bbcf07a1c78a6f2c'),
    ).toBeTruthy()
  })
})
