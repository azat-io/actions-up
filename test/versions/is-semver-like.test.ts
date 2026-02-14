import { describe, expect, it } from 'vitest'

import { isSemverLike } from '../../core/versions/is-semver-like'

describe('isSemverLike', () => {
  it('returns false for nullish and non-string values', () => {
    expect(isSemverLike(null)).toBeFalsy()
    expect(isSemverLike(undefined)).toBeFalsy()
  })

  it('returns true for semver-like values', () => {
    expect(isSemverLike('v1')).toBeTruthy()
    expect(isSemverLike('1.2')).toBeTruthy()
    expect(isSemverLike('  v3.4.5  ')).toBeTruthy()
  })

  it('returns false for non semver-like values', () => {
    expect(isSemverLike('main')).toBeFalsy()
    expect(isSemverLike('v1.2.3.4')).toBeFalsy()
    expect(isSemverLike('release-v1')).toBeFalsy()
  })
})
