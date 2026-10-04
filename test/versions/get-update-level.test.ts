import { afterEach, describe, expect, it, vi } from 'vitest'
import semver from 'semver'

import { getUpdateLevel } from '../../core/versions/get-update-level'

describe('getUpdateLevel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['v1', 'v2', 'major'],
    ['1.2.0', '1.3.0', 'minor'],
    ['v1.2.3', 'v1.2.4', 'patch'],
    ['v1.0.0', '1.0.0', 'none'],
  ])('rates the update from %s to %s as %s', (current, latest, expected) => {
    expect(getUpdateLevel(current, latest)).toBe(expected)
  })

  it.each([
    ['1.0.0', '2.0.0-rc.1', 'major'],
    ['1.0.0', '1.1.0-beta.1', 'minor'],
    ['1.0.0', '1.0.1-beta.1', 'patch'],
  ])(
    'rates the update from %s to the prerelease %s by its release core as %s',
    (current, latest, expected) => {
      expect(getUpdateLevel(current, latest)).toBe(expected)
    },
  )

  it.each([
    ['main', 'v1.0.0'],
    ['v1.0.0', 'main'],
    [null, '1.0.0'],
    ['1.0.0', undefined],
    ['', '1.0.0'],
  ])('returns unknown when %j or %j carries no version', (current, latest) => {
    expect(getUpdateLevel(current, latest)).toBe('unknown')
  })

  describe('defensive branches unreachable through the public API', () => {
    /**
     * Both versions are coerced to plain `x.y.z` before the comparison and
     * equal versions return early, so the real `semver.diff` only ever answers
     * major, minor or patch here. The stub decides the difference, which makes
     * the compared versions irrelevant.
     */
    it.each([
      ['premajor', 'major'],
      ['preminor', 'minor'],
      ['prepatch', 'patch'],
    ] as const)('rates a %s difference as %s', (difference, expected) => {
      vi.spyOn(semver, 'diff').mockReturnValue(difference)

      let result = getUpdateLevel('1.0.0', '1.0.1')

      expect(result).toBe(expected)
    })

    it('returns none when semver reports no difference between the versions', () => {
      vi.spyOn(semver, 'diff').mockReturnValue(null)

      let result = getUpdateLevel('1.0.0', '1.0.1')

      expect(result).toBe('none')
    })

    it('returns unknown for a difference kind it does not rate', () => {
      vi.spyOn(semver, 'diff').mockReturnValue('prerelease')

      let result = getUpdateLevel('1.0.0', '1.0.1')

      expect(result).toBe('unknown')
    })
  })
})
