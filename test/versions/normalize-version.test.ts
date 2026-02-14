import { describe, expect, it } from 'vitest'

import { normalizeVersion } from '../../core/versions/normalize-version'

describe('normalizeVersion', () => {
  it('returns null for empty input', () => {
    expect(normalizeVersion(null)).toBeNull()
    expect(normalizeVersion(undefined)).toBeNull()
    expect(normalizeVersion('')).toBeNull()
  })

  it('preserves sha-like versions including v-prefixed values', () => {
    expect(normalizeVersion('abcdef1234567')).toBe('abcdef1234567')
    /* Cspell:disable-next-line */
    expect(normalizeVersion('vabcdef1234567')).toBe('vabcdef1234567')
  })

  it('coerces semver-like values to normalized semver', () => {
    expect(normalizeVersion('v1')).toBe('1.0.0')
    expect(normalizeVersion('1.2')).toBe('1.2.0')
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
  })

  it('returns original value when semver coercion fails', () => {
    expect(normalizeVersion('latest')).toBe('latest')
    expect(normalizeVersion('release-bundle')).toBe('release-bundle')
  })
})
