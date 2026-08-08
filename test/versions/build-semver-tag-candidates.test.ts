import { describe, expect, it } from 'vitest'

import { buildSemverTagCandidates } from '../../core/versions/build-semver-tag-candidates'

describe('buildSemverTagCandidates', () => {
  it('prefers minor granularity in patch mode', () => {
    expect(buildSemverTagCandidates('v6.2.3', 'patch')).toEqual(['v6.2', 'v6'])
  })

  it('prefers major granularity in minor mode', () => {
    expect(buildSemverTagCandidates('v6.2.3', 'minor')).toEqual(['v6'])
  })

  it('prefers major granularity in major mode', () => {
    expect(buildSemverTagCandidates('v6.2.3', 'major')).toEqual(['v6'])
  })

  it('keeps tags without v prefix unprefixed', () => {
    expect(buildSemverTagCandidates('6.2.3', 'major')).toEqual(['6'])
  })

  it('returns empty array when latest is already at preferred granularity', () => {
    expect(buildSemverTagCandidates('v6.2', 'patch')).toEqual([])
    expect(buildSemverTagCandidates('v6', 'major')).toEqual([])
    expect(buildSemverTagCandidates('v6', 'patch')).toEqual([])
  })

  it('builds a major candidate for two-segment latest outside patch mode', () => {
    expect(buildSemverTagCandidates('v6.2', 'major')).toEqual(['v6'])
  })

  it('returns empty array when latest version is missing', () => {
    expect(buildSemverTagCandidates(null, 'major')).toEqual([])
    expect(buildSemverTagCandidates(undefined, 'major')).toEqual([])
  })

  it('returns empty array when latest version is not semver-like', () => {
    expect(buildSemverTagCandidates('nightly', 'major')).toEqual([])
  })
})
