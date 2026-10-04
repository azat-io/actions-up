import { describe, expect, it } from 'vitest'

import { getFamilyPrefix } from '../../core/versions/get-family-prefix'

describe('getFamilyPrefix', () => {
  it.each([
    ['v1.2.3', '', 'a lowercase v is dropped'],
    ['V1.0.0', '', 'an uppercase V is dropped'],
    ['1.2.3', '', 'an unprefixed tag shares the plain family'],
    ['actions-v0.1.1', 'actions-', 'the v ending a named family is dropped'],
    ['actions-0.1.1', 'actions-', 'a named family without its v is the same'],
    ['@scope/pkg@0.2.3', '@scope/pkg@', 'a scoped package name is kept'],
    [
      'get-vault-secrets/v2.0.1',
      'get-vault-secrets/',
      'a v inside the family name is kept',
    ],
    ['vv1.0.0', 'v', 'only one of two trailing v is dropped'],
  ])('resolves %s to the family prefix %j (%s)', (tag, expected) => {
    expect(getFamilyPrefix(tag)).toBe(expected)
  })

  it.each<[string | null, string]>([
    ['nightly', 'a reference without a version'],
    ['59b9d7edfcad5b87fbe3f473a9a134a721ad03f8', 'a SHA reference'],
    [null, 'a missing reference'],
  ])('returns null for %s (%s)', tag => {
    expect(getFamilyPrefix(tag)).toBeNull()
  })
})
