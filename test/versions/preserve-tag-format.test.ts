import { describe, expect, it } from 'vitest'

import { preserveTagFormat } from '../../core/versions/preserve-tag-format'

describe('preserveTagFormat', () => {
  it('returns null when either version is missing', () => {
    expect(preserveTagFormat(null, 'v7.0.2')).toBeNull()
    expect(preserveTagFormat('v6', null)).toBeNull()
  })

  it('preserves major-only tag refs', () => {
    expect(preserveTagFormat('v6', 'v7.0.2')).toBe('v7')
  })

  it('preserves tag refs without a v-prefix', () => {
    expect(preserveTagFormat('6', '7.0.2')).toBe('7')
  })

  it('preserves minor tag refs', () => {
    expect(preserveTagFormat('v6.1', 'v6.2.3')).toBe('v6.2')
  })

  it('preserves patch tag refs', () => {
    expect(preserveTagFormat('v6.1.4', 'v6.2.3')).toBe('v6.2.3')
  })

  it('returns null when the v-prefix style changes', () => {
    expect(preserveTagFormat('v6', '7.0.2')).toBeNull()
  })

  it('returns null when either ref is not semver-like', () => {
    expect(preserveTagFormat('stable', 'stable-2')).toBeNull()
  })

  it('returns null when the latest tag is less specific than the current tag', () => {
    expect(preserveTagFormat('v6.1', 'v7')).toBeNull()
  })

  it('preserves prefixed tag families', () => {
    expect(preserveTagFormat('actions-v0.1', 'actions-v0.2.3')).toBe(
      'actions-v0.2',
    )
    expect(preserveTagFormat('actions-v0', 'actions-v0.2.3')).toBe('actions-v0')
    expect(preserveTagFormat('@scope/pkg@1.2.3', '@scope/pkg@1.3.0')).toBe(
      '@scope/pkg@1.3.0',
    )
  })

  it('never projects a tag onto another family', () => {
    expect(preserveTagFormat('actions-v0.1', 'v0.2.3')).toBeNull()
    expect(preserveTagFormat('v0.1', 'actions-v0.2.3')).toBeNull()
  })
})
