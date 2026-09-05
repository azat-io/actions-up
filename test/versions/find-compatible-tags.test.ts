import { describe, expect, it, vi } from 'vitest'
import semver from 'semver'

import { findCompatibleTags } from '../../core/versions/find-compatible-tags'

describe('findCompatibleTags', () => {
  it('returns nothing when current version is missing', () => {
    let result = findCompatibleTags(
      [{ sha: 'sha-420', tag: 'v4.2.0', message: null, date: null }],
      null,
      'minor',
    )
    expect(result).toEqual([])
  })

  it('returns nothing when current version is not semver-like', () => {
    let result = findCompatibleTags(
      [{ sha: 'sha-420', tag: 'v4.2.0', message: null, date: null }],
      'main',
      'minor',
    )
    expect(result).toEqual([])
  })

  it('returns nothing when tags list is empty', () => {
    let result = findCompatibleTags([], 'v4.0.0', 'minor')
    expect(result).toEqual([])
  })

  it('returns nothing when current version cannot be validated', () => {
    let validSpy = vi.spyOn(semver, 'valid').mockReturnValueOnce(null)

    let result = findCompatibleTags(
      [{ sha: 'sha-420', tag: 'v4.2.0', message: null, date: null }],
      'v4.0.0',
      'minor',
    )

    expect(result).toEqual([])
    validSpy.mockRestore()
  })

  it('ranks compatible minor tags newest first', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-500', tag: 'v5.0.0', message: null, date: null },
        { sha: 'sha-432', tag: 'v4.3.2', message: null, date: null },
        { sha: 'sha-429', tag: 'v4.2.9', message: null, date: null },
      ],
      'v4.1.0',
      'minor',
    )
    expect(result.map(tag => tag.tag)).toEqual(['v4.3.2', 'v4.2.9'])
    expect(result[0]?.sha).toBe('sha-432')
  })

  it('ranks compatible patch tags newest first', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-430', tag: 'v4.3.0', message: null, date: null },
        { sha: 'sha-424', tag: 'v4.2.4', message: null, date: null },
        { sha: 'sha-427', tag: 'v4.2.7', message: null, date: null },
      ],
      'v4.2.1',
      'patch',
    )
    expect(result.map(tag => tag.tag)).toEqual(['v4.2.7', 'v4.2.4'])
  })

  it('keeps other majors in major mode', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-600', tag: 'v6.0.0', message: null, date: null },
        { sha: 'sha-500', tag: 'v5.0.0', message: null, date: null },
        { sha: 'sha-410', tag: 'v4.1.0', message: null, date: null },
      ],
      'v4.0.0',
      'major',
    )
    expect(result.map(tag => tag.tag)).toEqual(['v6.0.0', 'v5.0.0', 'v4.1.0'])
  })

  it('ignores versions that are not greater than current', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-400', tag: 'v4.0.0', message: null, date: null },
        { sha: 'sha-399', tag: 'v3.9.9', message: null, date: null },
      ],
      'v4.0.0',
      'minor',
    )
    expect(result).toEqual([])
  })

  it('prefers more specific tag when normalized versions are equal', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-short', message: null, tag: 'v1.1', date: null },
        { sha: 'sha-specific', tag: 'v1.1.0', message: null, date: null },
      ],
      'v1.0.0',
      'minor',
    )
    expect(result.map(tag => tag.tag)).toEqual(['v1.1.0', 'v1.1'])
    expect(result[0]?.sha).toBe('sha-specific')
  })

  it('returns nothing when no compatible candidate exists for mode', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-430', tag: 'v4.3.0', message: null, date: null },
        { sha: 'sha-500', tag: 'v5.0.0', message: null, date: null },
      ],
      'v4.2.2',
      'patch',
    )
    expect(result).toEqual([])
  })

  it('ignores non-semver tags in candidates list', () => {
    let result = findCompatibleTags(
      [
        { sha: 'sha-stable', tag: 'stable', message: null, date: null },
        { sha: 'sha-421', tag: 'v4.2.1', message: null, date: null },
      ],
      'v4.2.0',
      'patch',
    )
    expect(result.map(tag => tag.tag)).toEqual(['v4.2.1'])
  })

  it('ignores tags that fail semver validation after normalization', () => {
    let validSpy = vi
      .spyOn(semver, 'valid')
      .mockReturnValueOnce('4.0.0')
      .mockReturnValueOnce(null)

    let result = findCompatibleTags(
      [{ sha: 'sha-421', tag: 'v4.2.1', message: null, date: null }],
      'v4.0.0',
      'minor',
    )

    expect(result).toEqual([])
    validSpy.mockRestore()
  })

  it('finds compatible tags inside a prefixed family', () => {
    let tags = [
      { tag: 'actions-v0.1.2', message: null, date: null, sha: 'a' },
      { tag: 'actions-v0.2.0', message: null, date: null, sha: 'b' },
      { tag: 'v0.9.9', message: null, date: null, sha: 'c' },
    ]

    expect(
      findCompatibleTags(tags, 'actions-v0.1.1', 'patch').map(tag => tag.tag),
    ).toEqual(['actions-v0.1.2'])
    expect(
      findCompatibleTags(tags, 'actions-v0.1.1', 'minor').map(tag => tag.tag),
    ).toEqual(['actions-v0.2.0', 'actions-v0.1.2'])
  })

  it('never crosses into another tag family', () => {
    let tags = [{ tag: 'v0.9.9', message: null, date: null, sha: 'c' }]

    expect(findCompatibleTags(tags, 'actions-v0.1.1', 'minor')).toEqual([])
  })
})
