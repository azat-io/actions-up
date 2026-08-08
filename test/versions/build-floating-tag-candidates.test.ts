import { describe, expect, it } from 'vitest'

import { buildFloatingTagCandidates } from '../../core/versions/build-floating-tag-candidates'

describe('buildFloatingTagCandidates', () => {
  it('builds candidates from current granularity down to major', () => {
    expect(buildFloatingTagCandidates('v6.1', 'v6.2.3')).toEqual(['v6.2', 'v6'])
  })

  it('builds a single major candidate for major-only current tag', () => {
    expect(buildFloatingTagCandidates('v7', 'v8.3.2')).toEqual(['v8'])
  })

  it('keeps tags without v prefix unprefixed', () => {
    expect(buildFloatingTagCandidates('6.1', '6.2.3')).toEqual(['6.2', '6'])
  })

  it('returns empty array when current version is missing', () => {
    expect(buildFloatingTagCandidates(null, 'v6.2.3')).toEqual([])
    expect(buildFloatingTagCandidates(undefined, 'v6.2.3')).toEqual([])
  })

  it('returns empty array when latest version is missing', () => {
    expect(buildFloatingTagCandidates('v6.1', null)).toEqual([])
    expect(buildFloatingTagCandidates('v6.1', undefined)).toEqual([])
  })

  it('returns empty array when current version is not semver-like', () => {
    expect(buildFloatingTagCandidates('main', 'v6.2.3')).toEqual([])
  })

  it('returns empty array when latest version is not semver-like', () => {
    expect(buildFloatingTagCandidates('v6.1', 'nightly')).toEqual([])
  })

  it('returns empty array when v prefixes differ', () => {
    expect(buildFloatingTagCandidates('6.1', 'v6.2.3')).toEqual([])
  })

  it('returns empty array when granularity matches', () => {
    expect(buildFloatingTagCandidates('v1.2.3', 'v2.0.1')).toEqual([])
  })

  it('returns empty array when latest is less specific than current', () => {
    expect(buildFloatingTagCandidates('v1.2.3', 'v2')).toEqual([])
  })
})
