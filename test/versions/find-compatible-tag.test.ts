import { describe, expect, it, vi } from 'vitest'
import semver from 'semver'

import { findCompatibleTag } from '../../core/versions/find-compatible-tag'

describe('findCompatibleTag', () => {
  it('returns null when current version is missing', () => {
    let result = findCompatibleTag(
      [{ sha: 'sha-420', tag: 'v4.2.0', message: null, date: null }],
      null,
      'minor',
    )
    expect(result).toBeNull()
  })

  it('returns null when current version is not semver-like', () => {
    let result = findCompatibleTag(
      [{ sha: 'sha-420', tag: 'v4.2.0', message: null, date: null }],
      'main',
      'minor',
    )
    expect(result).toBeNull()
  })

  it('returns null when tags list is empty', () => {
    let result = findCompatibleTag([], 'v4.0.0', 'minor')
    expect(result).toBeNull()
  })

  it('returns null when current version cannot be validated', () => {
    let validSpy = vi.spyOn(semver, 'valid').mockReturnValueOnce(null)

    let result = findCompatibleTag(
      [{ sha: 'sha-420', tag: 'v4.2.0', message: null, date: null }],
      'v4.0.0',
      'minor',
    )

    expect(result).toBeNull()
    validSpy.mockRestore()
  })

  it('selects highest compatible minor tag', () => {
    let result = findCompatibleTag(
      [
        { sha: 'sha-500', tag: 'v5.0.0', message: null, date: null },
        { sha: 'sha-432', tag: 'v4.3.2', message: null, date: null },
        { sha: 'sha-429', tag: 'v4.2.9', message: null, date: null },
      ],
      'v4.1.0',
      'minor',
    )
    expect(result?.tag).toBe('v4.3.2')
    expect(result?.sha).toBe('sha-432')
  })

  it('selects highest compatible patch tag', () => {
    let result = findCompatibleTag(
      [
        { sha: 'sha-430', tag: 'v4.3.0', message: null, date: null },
        { sha: 'sha-424', tag: 'v4.2.4', message: null, date: null },
        { sha: 'sha-427', tag: 'v4.2.7', message: null, date: null },
      ],
      'v4.2.1',
      'patch',
    )
    expect(result?.tag).toBe('v4.2.7')
    expect(result?.sha).toBe('sha-427')
  })

  it('ignores versions that are not greater than current', () => {
    let result = findCompatibleTag(
      [
        { sha: 'sha-400', tag: 'v4.0.0', message: null, date: null },
        { sha: 'sha-399', tag: 'v3.9.9', message: null, date: null },
      ],
      'v4.0.0',
      'minor',
    )
    expect(result).toBeNull()
  })

  it('prefers more specific tag when normalized versions are equal', () => {
    let result = findCompatibleTag(
      [
        { sha: 'sha-short', message: null, tag: 'v1.1', date: null },
        { sha: 'sha-specific', tag: 'v1.1.0', message: null, date: null },
      ],
      'v1.0.0',
      'minor',
    )
    expect(result?.tag).toBe('v1.1.0')
    expect(result?.sha).toBe('sha-specific')
  })

  it('returns null when no compatible candidate exists for mode', () => {
    let result = findCompatibleTag(
      [
        { sha: 'sha-430', tag: 'v4.3.0', message: null, date: null },
        { sha: 'sha-500', tag: 'v5.0.0', message: null, date: null },
      ],
      'v4.2.2',
      'patch',
    )
    expect(result).toBeNull()
  })

  it('ignores non-semver tags in candidates list', () => {
    let result = findCompatibleTag(
      [
        { sha: 'sha-stable', tag: 'stable', message: null, date: null },
        { sha: 'sha-421', tag: 'v4.2.1', message: null, date: null },
      ],
      'v4.2.0',
      'patch',
    )
    expect(result?.tag).toBe('v4.2.1')
  })

  it('ignores tags that fail semver validation after normalization', () => {
    let validSpy = vi
      .spyOn(semver, 'valid')
      .mockReturnValueOnce('4.0.0')
      .mockReturnValueOnce(null)

    let result = findCompatibleTag(
      [{ sha: 'sha-421', tag: 'v4.2.1', message: null, date: null }],
      'v4.0.0',
      'minor',
    )

    expect(result).toBeNull()
    validSpy.mockRestore()
  })
})
