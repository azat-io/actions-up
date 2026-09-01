import { describe, expect, it } from 'vitest'

import { isSameTagFamily } from '../../core/versions/is-same-tag-family'

describe('isSameTagFamily', () => {
  it('accepts members of one prefixed family', () => {
    expect(isSameTagFamily('actions-v0.1.1', 'actions-v0.2.0')).toBeTruthy()
    expect(isSameTagFamily('actions-v0', 'actions-v0.1.1')).toBeTruthy()
    expect(
      isSameTagFamily('get-vault-secrets/v1.2.0', 'get-vault-secrets/v2.0.1'),
    ).toBeTruthy()
    expect(isSameTagFamily('astro@7.2.8', 'astro@7.2.9')).toBeTruthy()
  })

  it('rejects candidates from a different family', () => {
    expect(isSameTagFamily('actions-v0.1.1', 'v0.2.3')).toBeFalsy()
    expect(isSameTagFamily('v4.32.0', 'codeql-bundle-v2.26.4')).toBeFalsy()
    expect(isSameTagFamily('release/v1', 'v1.2.3')).toBeFalsy()
    expect(isSameTagFamily('@bedrock-rbx/core@0.2.3', 'v0.2.3')).toBeFalsy()
  })

  it('normalizes a single trailing v on both sides', () => {
    expect(isSameTagFamily('v1.0.0', '1.1.0')).toBeTruthy()
    expect(isSameTagFamily('1.0.0', 'v1.1.0')).toBeTruthy()
    expect(isSameTagFamily('V1.0.0', 'v1.1.0')).toBeTruthy()
    expect(isSameTagFamily('v1', '1')).toBeTruthy()
    expect(isSameTagFamily('actions-v0.1.1', 'actions-0.2.0')).toBeTruthy()
  })

  it('keeps prerelease and build metadata inside the family', () => {
    expect(isSameTagFamily('v2.0.0-rc.1', 'v2.0.0')).toBeTruthy()
    expect(isSameTagFamily('v1.2.3-linux', 'v1.2.4')).toBeTruthy()
    expect(isSameTagFamily('v1.2.3+build.5', 'v1.2.4')).toBeTruthy()
  })

  it('does not block references without a detectable family', () => {
    expect(isSameTagFamily('v1', 'nightly')).toBeTruthy()
    expect(isSameTagFamily('dev-build', 'latest')).toBeTruthy()
    expect(isSameTagFamily('stable', 'v1.0.0')).toBeTruthy()
    expect(isSameTagFamily('v1.0.0', 'release')).toBeTruthy()
    expect(isSameTagFamily('1.2.3.4', '1.2.3.5')).toBeTruthy()
  })

  it('does not block SHA references', () => {
    expect(
      isSameTagFamily('59b9d7edfcad5b87fbe3f473a9a134a721ad03f8', 'v1.0.0'),
    ).toBeTruthy()
    expect(isSameTagFamily('actions-v0.1.1', 'deadbeef')).toBeTruthy()
  })

  it('does not block nullish input', () => {
    expect(isSameTagFamily(null, 'v1.0.0')).toBeTruthy()
    expect(isSameTagFamily(undefined, 'v1.0.0')).toBeTruthy()
    expect(isSameTagFamily('v1.0.0', null)).toBeTruthy()
    expect(isSameTagFamily('', 'v1.0.0')).toBeTruthy()
  })

  it('tolerates surrounding whitespace', () => {
    expect(isSameTagFamily('  actions-v0.1.1  ', 'actions-v0.2.0')).toBeTruthy()
  })
})
