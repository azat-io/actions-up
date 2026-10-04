import { describe, expect, it } from 'vitest'

import { isSameTagFamily } from '../../core/versions/is-same-tag-family'

describe('isSameTagFamily', () => {
  it.each([
    ['actions-v0.1.1', 'actions-v0.2.0'],
    ['actions-v0', 'actions-v0.1.1'],
    ['get-vault-secrets/v1.2.0', 'get-vault-secrets/v2.0.1'],
    ['astro@7.2.8', 'astro@7.2.9'],
  ])(
    'accepts %s and %s as members of one prefixed family',
    (current, candidate) => {
      expect(isSameTagFamily(current, candidate)).toBeTruthy()
    },
  )

  it.each([
    ['actions-v0.1.1', 'v0.2.3'],
    ['v4.32.0', 'codeql-bundle-v2.26.4'],
    ['release/v1', 'v1.2.3'],
    ['@bedrock-rbx/core@0.2.3', 'v0.2.3'],
  ])('rejects %s and %s as different families', (current, candidate) => {
    expect(isSameTagFamily(current, candidate)).toBeFalsy()
  })

  it.each([
    ['v1.0.0', '1.1.0'],
    ['1.0.0', 'v1.1.0'],
    ['V1.0.0', 'v1.1.0'],
    ['v1', '1'],
    ['actions-v0.1.1', 'actions-0.2.0'],
  ])(
    'normalizes a single trailing v when comparing %s with %s',
    (current, candidate) => {
      expect(isSameTagFamily(current, candidate)).toBeTruthy()
    },
  )

  it('keeps the first v of a doubled one as part of the family', () => {
    expect(isSameTagFamily('vv1.0.0', 'v1.1.0')).toBeFalsy()
  })

  it.each([
    ['v2.0.0-rc.1', 'v2.0.0'],
    ['v1.2.3-linux', 'v1.2.4'],
    ['v1.2.3+build.5', 'v1.2.4'],
  ])('keeps the qualified %s inside the family of %s', (current, candidate) => {
    expect(isSameTagFamily(current, candidate)).toBeTruthy()
  })

  it.each([
    ['v1', 'nightly'],
    ['dev-build', 'latest'],
    ['stable', 'v1.0.0'],
    ['v1.0.0', 'release'],
    ['actions-v1.2.3.4', 'v1.2.3.5'],
  ])(
    'does not block %s and %s when one has no detectable family',
    (current, candidate) => {
      expect(isSameTagFamily(current, candidate)).toBeTruthy()
    },
  )

  it.each([
    ['59b9d7edfcad5b87fbe3f473a9a134a721ad03f8', 'v1.0.0'],
    ['actions-v0.1.1', 'a1b2c3d4'],
  ])(
    'does not block %s and %s when one is a SHA reference',
    (current, candidate) => {
      expect(isSameTagFamily(current, candidate)).toBeTruthy()
    },
  )

  it.each([
    [null, 'v1.0.0'],
    [undefined, 'v1.0.0'],
    ['v1.0.0', null],
    ['', 'v1.0.0'],
  ])(
    'does not block %j and %j when one reference is missing or empty',
    (current, candidate) => {
      expect(isSameTagFamily(current, candidate)).toBeTruthy()
    },
  )

  it.each([
    ['accepts', 'actions-v0.2.0', true],
    ['rejects', 'v0.2.3', false],
  ])(
    '%s %s for a reference with surrounding whitespace',
    (_verdict, candidate, expected) => {
      expect(isSameTagFamily('  actions-v0.1.1  ', candidate)).toBe(expected)
    },
  )
})
