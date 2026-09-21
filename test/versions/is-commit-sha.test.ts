import { describe, expect, it } from 'vitest'

import { isCommitSha } from '../../core/versions/is-commit-sha'

describe('isCommitSha', () => {
  it('returns true for short and full commit SHAs in any case', () => {
    expect(isCommitSha('abcdef0')).toBeTruthy()
    expect(isCommitSha('ABCDEF0')).toBeTruthy()
    expect(isCommitSha('a'.repeat(40))).toBeTruthy()
  })

  it('returns false for values with a v prefix', () => {
    expect(isCommitSha('v20240101')).toBeFalsy()
    expect(isCommitSha(`v${'a'.repeat(40)}`)).toBeFalsy()
  })

  it('returns false for invalid lengths, characters and empty values', () => {
    expect(isCommitSha('abcdef')).toBeFalsy()
    expect(isCommitSha('a'.repeat(41))).toBeFalsy()
    expect(isCommitSha('xyz1234')).toBeFalsy()
    expect(isCommitSha('main')).toBeFalsy()
    expect(isCommitSha('')).toBeFalsy()
    expect(isCommitSha(null)).toBeFalsy()
    expect(isCommitSha(undefined)).toBeFalsy()
  })
})
