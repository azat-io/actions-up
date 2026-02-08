import { describe, expect, it } from 'vitest'

import { isSha } from '../../core/versions/is-sha'

describe('isSha', () => {
  it('returns true for valid SHA strings', () => {
    expect(isSha('a1b2c3d')).toBeTruthy()
    expect(isSha(`v${'a'.repeat(40)}`)).toBeTruthy()
  })

  it('returns false for invalid values', () => {
    expect(isSha('abc')).toBeFalsy()
    expect(isSha('not-a-sha')).toBeFalsy()
    expect(isSha(null)).toBeFalsy()
  })

  it('handles boundary lengths and invalid characters', () => {
    expect(isSha('abcdef')).toBeFalsy()
    expect(isSha('abcdef0')).toBeTruthy()
    expect(isSha('a'.repeat(40))).toBeTruthy()
    expect(isSha('a'.repeat(41))).toBeFalsy()
    expect(isSha('xyz1234')).toBeFalsy()
  })
})
