import { describe, expect, it } from 'vitest'

import { isSemverLike } from '../../core/versions/is-semver-like'

describe('isSemverLike', () => {
  it.each([null, undefined])('returns false for %s', value => {
    expect(isSemverLike(value)).toBeFalsy()
  })

  it.each(['v1', '1.2', '  v3.4.5  ', 'v20.11.1'])('accepts %j', value => {
    expect(isSemverLike(value)).toBeTruthy()
  })

  it.each(['main', 'v1.2.3.4', 'release-v1'])('rejects %s', value => {
    expect(isSemverLike(value)).toBeFalsy()
  })
})
