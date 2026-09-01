import { describe, expect, it } from 'vitest'

import { parseTagFamily } from '../../core/versions/parse-tag-family'

describe('parseTagFamily', () => {
  it('returns null for nullish and empty values', () => {
    expect(parseTagFamily(null)).toBeNull()
    expect(parseTagFamily(undefined)).toBeNull()
    expect(parseTagFamily('')).toBeNull()
    expect(parseTagFamily(' '.repeat(3))).toBeNull()
  })

  it('returns null for SHA references', () => {
    expect(
      parseTagFamily('59b9d7edfcad5b87fbe3f473a9a134a721ad03f8'),
    ).toBeNull()
    expect(parseTagFamily('abcdef1234567')).toBeNull()
    expect(parseTagFamily('deadbeef')).toBeNull()
  })

  it('returns null for references without a version', () => {
    expect(parseTagFamily('main')).toBeNull()
    expect(parseTagFamily('nightly')).toBeNull()
    expect(parseTagFamily('latest')).toBeNull()
    expect(parseTagFamily('stable')).toBeNull()
    expect(parseTagFamily('dev-build')).toBeNull()
  })

  it('returns null for cores semver cannot represent', () => {
    expect(parseTagFamily('1.2.3.4')).toBeNull()
    expect(parseTagFamily('v1.2.3.4')).toBeNull()
    expect(parseTagFamily('v01.02.03')).toBeNull()
    expect(parseTagFamily('v12345678901234567890')).toBeNull()
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

  it('parses prefixed tag families', () => {
    expect(parseTagFamily('actions-v0.1.1')).toMatchObject({
      prefix: 'actions-v',
      version: '0.1.1',
      core: '0.1.1',
    })
    expect(parseTagFamily('actions-v0')).toMatchObject({
      prefix: 'actions-v',
      version: '0.0.0',
      core: '0',
    })
    expect(parseTagFamily('codeql-bundle-v2.26.4')).toMatchObject({
      prefix: 'codeql-bundle-v',
      version: '2.26.4',
    })
    expect(parseTagFamily('get-vault-secrets/v2.0.1')).toMatchObject({
      prefix: 'get-vault-secrets/v',
      version: '2.0.1',
    })
    expect(parseTagFamily('release/v1')).toMatchObject({
      prefix: 'release/v',
      version: '1.0.0',
    })
    expect(parseTagFamily('build-123')).toMatchObject({
      version: '123.0.0',
      prefix: 'build-',
    })
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
