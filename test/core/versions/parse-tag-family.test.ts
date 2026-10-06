import { describe, expect, it } from 'vitest'

import type { TagFamily } from '../../../types/tag-family'

import { parseTagFamily } from '../../../core/versions/parse-tag-family'

describe('parseTagFamily', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', ' '.repeat(3)],
  ])('returns null for %s', (_description, tag) => {
    expect(parseTagFamily(tag)).toBeNull()
  })

  it.each([
    '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    'abcdef1234567',
    'a1b2c3d4',
  ])('returns null for the SHA reference %s', tag => {
    expect(parseTagFamily(tag)).toBeNull()
  })

  it.each(['main', 'nightly', 'latest', 'stable', 'dev-build'])(
    'returns null for %s, which carries no version',
    tag => {
      expect(parseTagFamily(tag)).toBeNull()
    },
  )

  it.each([
    ['1.2.3.4', 'four segments'],
    ['v1.2.3.4', 'four segments behind a v'],
    ['v01.02.03', 'leading zeros'],
    [
      'build-12345678901234567890',
      'a core beyond the safe integer range, prefixed so it is not read as a SHA',
    ],
  ])('returns null for %s, whose core semver cannot represent (%s)', tag => {
    expect(parseTagFamily(tag)).toBeNull()
  })

  it('parses plain semver tags', () => {
    expect(parseTagFamily('v1.2.3')).toEqual({
      version: '1.2.3',
      specificity: 3,
      qualifier: '',
      core: '1.2.3',
      prefix: 'v',
    })
    expect(parseTagFamily('1.2.3')).toEqual({
      version: '1.2.3',
      specificity: 3,
      qualifier: '',
      core: '1.2.3',
      prefix: '',
    })
    expect(parseTagFamily('V1.0.0')).toMatchObject({ prefix: 'V' })
  })

  it('pads floating tags to a comparable version', () => {
    expect(parseTagFamily('v1')).toMatchObject({
      version: '1.0.0',
      specificity: 1,
      prefix: 'v',
      core: '1',
    })
    expect(parseTagFamily('v1.14')).toMatchObject({
      version: '1.14.0',
      specificity: 2,
      core: '1.14',
    })
  })

  it.each<[string, TagFamily]>([
    [
      'actions-v0.1.1',
      {
        prefix: 'actions-v',
        version: '0.1.1',
        specificity: 3,
        qualifier: '',
        core: '0.1.1',
      },
    ],
    [
      'actions-v0',
      {
        prefix: 'actions-v',
        version: '0.0.0',
        specificity: 1,
        qualifier: '',
        core: '0',
      },
    ],
    [
      'codeql-bundle-v2.26.4',
      {
        prefix: 'codeql-bundle-v',
        version: '2.26.4',
        specificity: 3,
        core: '2.26.4',
        qualifier: '',
      },
    ],
    [
      'get-vault-secrets/v2.0.1',
      {
        prefix: 'get-vault-secrets/v',
        version: '2.0.1',
        specificity: 3,
        qualifier: '',
        core: '2.0.1',
      },
    ],
    [
      'release/v1',
      {
        prefix: 'release/v',
        version: '1.0.0',
        specificity: 1,
        qualifier: '',
        core: '1',
      },
    ],
    [
      'build-123',
      {
        version: '123.0.0',
        prefix: 'build-',
        specificity: 1,
        qualifier: '',
        core: '123',
      },
    ],
  ])('parses the prefixed tag family of %s', (tag, expected) => {
    expect(parseTagFamily(tag)).toStrictEqual(expected)
  })

  it('keeps scoped package names out of the version', () => {
    expect(parseTagFamily('@bedrock-rbx/core@0.2.3')).toMatchObject({
      prefix: '@bedrock-rbx/core@',
      version: '0.2.3',
    })

    /**
     * `semver.coerce` reads this tag as `3.0.0` because it grabs the digit out
     * of `s3`, which is exactly why the family boundary is anchored at the
     * end.
     */
    expect(parseTagFamily('@bedrock-rbx/state-s3@0.2.3')).toMatchObject({
      prefix: '@bedrock-rbx/state-s3@',
      version: '0.2.3',
    })
    expect(parseTagFamily('astro@4.0.0')).toMatchObject({
      prefix: 'astro@',
      version: '4.0.0',
    })
  })

  it('keeps prerelease and build metadata on the version', () => {
    expect(parseTagFamily('v1.2.3-rc.1')).toMatchObject({
      version: '1.2.3-rc.1',
      qualifier: '-rc.1',
      prefix: 'v',
    })
    expect(parseTagFamily('v1.2.3-linux')).toMatchObject({
      version: '1.2.3-linux',
      qualifier: '-linux',
      prefix: 'v',
    })
    /**
     * Build metadata is ignored by semver precedence, so it survives on the
     * qualifier while the comparable version drops it.
     */
    expect(parseTagFamily('v1.2.3+build.5')).toMatchObject({
      qualifier: '+build.5',
      version: '1.2.3',
      prefix: 'v',
    })
    expect(parseTagFamily('v1-rc.1')).toMatchObject({
      version: '1.0.0-rc.1',
      qualifier: '-rc.1',
    })
  })

  it.each<[string, string, TagFamily]>([
    [
      'a prerelease number glued to its label',
      'v1.2.3-rc1',
      {
        version: '1.2.3-rc1',
        qualifier: '-rc1',
        specificity: 3,
        core: '1.2.3',
        prefix: 'v',
      },
    ],
    [
      'a glued prerelease of an unprefixed tag',
      '2.0.0-beta2',
      {
        version: '2.0.0-beta2',
        qualifier: '-beta2',
        specificity: 3,
        core: '2.0.0',
        prefix: '',
      },
    ],
    [
      'a glued prerelease of a named family',
      'actions-v1.4.0-alpha10',
      {
        version: '1.4.0-alpha10',
        qualifier: '-alpha10',
        prefix: 'actions-v',
        specificity: 3,
        core: '1.4.0',
      },
    ],
    [
      'glued build metadata',
      'v1.2.3+build5',
      {
        qualifier: '+build5',
        version: '1.2.3',
        specificity: 3,
        core: '1.2.3',
        prefix: 'v',
      },
    ],
  ])('keeps %s on the version of %s', (_description, tag, expected) => {
    expect(parseTagFamily(tag)).toStrictEqual(expected)
  })

  it.each([
    ['node20-v1.2.3', 'node20-v'],
    ['node20-v1', 'node20-v'],
    ['python3.11-v1.2.0', 'python3.11-v'],
  ])(
    'keeps the digits of the family name in the prefix of %s',
    (tag, prefix) => {
      expect(parseTagFamily(tag)).toMatchObject({ prefix })
    },
  )

  it('treats calendar versions as an unprefixed family', () => {
    expect(parseTagFamily('2024.10.1')).toMatchObject({
      version: '2024.10.1',
      prefix: '',
    })
    expect(parseTagFamily('2024')).toMatchObject({
      version: '2024.0.0',
      prefix: '',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseTagFamily('  actions-v0.1.1  ')).toMatchObject({
      prefix: 'actions-v',
      version: '0.1.1',
    })
  })
})
