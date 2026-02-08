import { describe, expect, it, vi } from 'vitest'
import semver from 'semver'

import { getUpdateLevel } from '../../core/versions/get-update-level'

describe('getUpdateLevel', () => {
  it('returns major for major changes', () => {
    expect(getUpdateLevel('v1', 'v2')).toBe('major')
  })

  it('returns minor for minor changes', () => {
    expect(getUpdateLevel('1.2.0', '1.3.0')).toBe('minor')
  })

  it('returns patch for patch changes', () => {
    expect(getUpdateLevel('v1.2.3', 'v1.2.4')).toBe('patch')
  })

  it('returns none when versions are equal', () => {
    expect(getUpdateLevel('v1.0.0', '1.0.0')).toBe('none')
  })

  it('returns unknown when versions are not semver', () => {
    expect(getUpdateLevel('main', 'v1.0.0')).toBe('unknown')
  })

  it('returns unknown when version is missing', () => {
    expect(getUpdateLevel(null, '1.0.0')).toBe('unknown')
  })

  it('returns none when semver diff is null', () => {
    let diffSpy = vi.spyOn(semver, 'diff').mockReturnValue(null)
    expect(getUpdateLevel('1.0.0', '1.0.1')).toBe('none')
    diffSpy.mockRestore()
  })

  it('returns unknown for unsupported diff types', () => {
    let diffSpy = vi
      .spyOn(semver, 'diff')
      .mockReturnValue('prerelease' as semver.ReleaseType)
    expect(getUpdateLevel('1.0.0', '1.0.1')).toBe('unknown')
    diffSpy.mockRestore()
  })

  it('maps premajor to major', () => {
    let diffSpy = vi
      .spyOn(semver, 'diff')
      .mockReturnValue('premajor' as semver.ReleaseType)
    expect(getUpdateLevel('1.0.0', '2.0.0-rc.1')).toBe('major')
    diffSpy.mockRestore()
  })

  it('maps preminor to minor', () => {
    let diffSpy = vi
      .spyOn(semver, 'diff')
      .mockReturnValue('preminor' as semver.ReleaseType)
    expect(getUpdateLevel('1.0.0', '1.1.0-beta.1')).toBe('minor')
    diffSpy.mockRestore()
  })

  it('maps prepatch to patch', () => {
    let diffSpy = vi
      .spyOn(semver, 'diff')
      .mockReturnValue('prepatch' as semver.ReleaseType)
    expect(getUpdateLevel('1.0.0', '1.0.1-beta.1')).toBe('patch')
    diffSpy.mockRestore()
  })
})
