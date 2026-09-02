import { describe, expect, it } from 'vitest'

import { parseVersionComment } from '../../core/versions/parse-version-comment'

describe('parseVersionComment', () => {
  it('returns null for nullish and empty comments', () => {
    expect(parseVersionComment(null)).toBeNull()
    expect(parseVersionComment(undefined)).toBeNull()
    expect(parseVersionComment('')).toBeNull()
    expect(parseVersionComment(' '.repeat(3))).toBeNull()
    expect(parseVersionComment('#')).toBeNull()
  })

  it('reads the tag actions-up writes next to a SHA pin', () => {
    expect(parseVersionComment(' v4.2.1')).toBe('v4.2.1')
    expect(parseVersionComment('# v4.2.1')).toBe('v4.2.1')
    expect(parseVersionComment('#v4.2.1')).toBe('v4.2.1')
    expect(parseVersionComment('  #  v4.2.1  ')).toBe('v4.2.1')
  })

  it('reads a prefixed tag family', () => {
    expect(parseVersionComment('# actions-v0.1.1')).toBe('actions-v0.1.1')
    expect(parseVersionComment('# get-vault-secrets/v2.0.1')).toBe(
      'get-vault-secrets/v2.0.1',
    )
    expect(parseVersionComment('# @bedrock-rbx/core@0.2.3')).toBe(
      '@bedrock-rbx/core@0.2.3',
    )
    expect(parseVersionComment('# codeql-bundle-v2.26.4')).toBe(
      'codeql-bundle-v2.26.4',
    )
  })

  it('ignores prose comments', () => {
    expect(parseVersionComment('# pinned to v1.2.3')).toBeNull()
    expect(parseVersionComment('# renovate: pin')).toBeNull()
    expect(parseVersionComment('# keep me')).toBeNull()
    expect(parseVersionComment('# see PR 123')).toBeNull()
  })

  it('ignores tokens that carry no version', () => {
    expect(parseVersionComment('# nightly')).toBeNull()
    expect(parseVersionComment('# main')).toBeNull()
    expect(parseVersionComment('# 1.2.3.4')).toBeNull()
  })

  it('keeps only the leading token', () => {
    expect(parseVersionComment('# v1.2.3 (breaking)')).toBe('v1.2.3')
  })
})
