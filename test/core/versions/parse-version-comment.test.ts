import { describe, expect, it } from 'vitest'

import { parseVersionComment } from '../../../core/versions/parse-version-comment'

describe('parseVersionComment', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty comment', ''],
    ['a whitespace-only comment', ' '.repeat(3)],
    ['a bare #', '#'],
  ])('returns null for %s', (_description, comment) => {
    expect(parseVersionComment(comment)).toBeNull()
  })

  it.each([' v4.2.1', '# v4.2.1', '#v4.2.1', '  #  v4.2.1  ', '## v4.2.1'])(
    'reads the tag actions-up writes next to a SHA pin from %j',
    comment => {
      expect(parseVersionComment(comment)).toBe('v4.2.1')
    },
  )

  it.each([
    ['# actions-v0.1.1', 'actions-v0.1.1'],
    ['# get-vault-secrets/v2.0.1', 'get-vault-secrets/v2.0.1'],
    ['# @bedrock-rbx/core@0.2.3', '@bedrock-rbx/core@0.2.3'],
    ['# codeql-bundle-v2.26.4', 'codeql-bundle-v2.26.4'],
  ])('reads a prefixed tag family from %j', (comment, expected) => {
    expect(parseVersionComment(comment)).toBe(expected)
  })

  it.each([
    '# pinned to v1.2.3',
    '# renovate: pin',
    '# keep me',
    '# see PR 123',
  ])('ignores the prose comment %j', comment => {
    expect(parseVersionComment(comment)).toBeNull()
  })

  it.each(['# nightly', '# main', '# 1.2.3.4'])(
    'ignores %j, whose token carries no version',
    comment => {
      expect(parseVersionComment(comment)).toBeNull()
    },
  )

  it.each([
    ['# v1.2.3 (breaking)', 'a note', 'v1.2.3'],
    [' v4.2.1 #123', 'an issue reference', 'v4.2.1'],
  ])(
    'keeps only the leading token of %j followed by %s',
    (comment, _description, expected) => {
      expect(parseVersionComment(comment)).toBe(expected)
    },
  )
})
