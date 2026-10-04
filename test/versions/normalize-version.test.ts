import { describe, expect, it } from 'vitest'

import { normalizeVersion } from '../../core/versions/normalize-version'

describe('normalizeVersion', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('returns null for %s', (_description, version) => {
    expect(normalizeVersion(version)).toBeNull()
  })

  it.each([
    ['a short SHA on the minimum length', '3b1f9d7'],
    ['a full-length SHA', '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'],
    ['an uppercase SHA', 'ABCDEF1234567'],
    ['a SHA behind a v prefix', 'v3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'],
  ])('keeps %s exactly as written', (_description, version) => {
    expect(normalizeVersion(version)).toBe(version)
  })

  it.each([
    ['v1', '1.0.0'],
    ['1.2', '1.2.0'],
    ['v1.2.3', '1.2.3'],
  ])('coerces %s to %s', (version, expected) => {
    expect(normalizeVersion(version)).toBe(expected)
  })

  it.each([
    ['one character below the minimum SHA length', '3b1f9d'],
    [
      'one character beyond a full SHA',
      '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2a',
    ],
  ])('does not keep a hex value %s as a SHA', (_description, version) => {
    expect(normalizeVersion(version)).not.toBe(version)
  })

  it.each(['latest', 'release-bundle'])(
    'returns %s unchanged when semver coercion fails',
    version => {
      expect(normalizeVersion(version)).toBe(version)
    },
  )

  describe('current behavior pending owner decision', () => {
    /**
     * A hex value outside the SHA length range is coerced like a version, and
     * `semver.coerce` takes its first run of digits, so a SHA abbreviation one
     * character too short turns into `3.0.0`.
     */
    it.each([
      ['one character below the minimum SHA length', '3b1f9d', '3.0.0'],
      [
        'one character beyond a full SHA',
        '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2a',
        '3.0.0',
      ],
    ])(
      'coerces a hex value %s from its first run of digits',
      (_description, version, expected) => {
        expect(normalizeVersion(version)).toBe(expected)
      },
    )
  })
})
