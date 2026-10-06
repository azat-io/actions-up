import { describe, expect, it } from 'vitest'

import type { UpdateMode } from '../../../types/update-mode'

import { findCompatibleTags } from '../../../core/versions/find-compatible-tags'
import { makeTagInfo } from '../../helpers/make-tag-info'

describe('findCompatibleTags', () => {
  it.each([null, 'main', 'v01.02.03'])(
    'returns nothing when the current reference %s carries no comparable version',
    current => {
      let tags = [makeTagInfo('v1.2.4'), makeTagInfo('v2.0.0')]

      let result = findCompatibleTags(tags, current, { mode: 'major' })

      expect(result).toStrictEqual([])
    },
  )

  it('returns nothing when there are no tags', () => {
    let result = findCompatibleTags([], 'v4.0.0', { mode: 'major' })

    expect(result).toStrictEqual([])
  })

  it('ranks compatible minor tags newest first', () => {
    let nextMajor = makeTagInfo('v5.0.0', {
      sha: '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2',
    })
    let olderMinor = makeTagInfo('v4.2.9', {
      sha: 'a1b2c3d4e5f6789012345678901234567890abcd',
    })
    let newerMinor = makeTagInfo('v4.3.2', {
      sha: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    })

    let result = findCompatibleTags(
      [nextMajor, olderMinor, newerMinor],
      'v4.1.0',
      { mode: 'minor' },
    )

    expect(result).toStrictEqual([newerMinor, olderMinor])
  })

  it('ranks compatible patch tags newest first', () => {
    let tags = [
      makeTagInfo('v4.3.0'),
      makeTagInfo('v4.2.4'),
      makeTagInfo('v4.2.7'),
    ]

    let result = findCompatibleTags(tags, 'v4.2.1', { mode: 'patch' })

    expect(result.map(({ tag }) => tag)).toStrictEqual(['v4.2.7', 'v4.2.4'])
  })

  it('keeps other majors in major mode', () => {
    let tags = [
      makeTagInfo('v5.0.0'),
      makeTagInfo('v4.1.0'),
      makeTagInfo('v6.0.0'),
    ]

    let result = findCompatibleTags(tags, 'v4.0.0', { mode: 'major' })

    expect(result.map(({ tag }) => tag)).toStrictEqual([
      'v6.0.0',
      'v5.0.0',
      'v4.1.0',
    ])
  })

  it('ranks newer releases of the same major for a floating major tag in minor mode', () => {
    let tags = [
      makeTagInfo('v5.0.0'),
      makeTagInfo('v4.0.1'),
      makeTagInfo('v4'),
      makeTagInfo('v4.3.1'),
      makeTagInfo('v3.9.0'),
    ]

    let result = findCompatibleTags(tags, 'v4', { mode: 'minor' })

    expect(result.map(({ tag }) => tag)).toStrictEqual(['v4.3.1', 'v4.0.1'])
  })

  it('ignores versions that are not greater than current', () => {
    let tags = [makeTagInfo('v4.0.0'), makeTagInfo('v3.9.9')]

    let result = findCompatibleTags(tags, 'v4.0.0', { mode: 'major' })

    expect(result).toStrictEqual([])
  })

  it('prefers more specific tag when normalized versions are equal', () => {
    let floating = makeTagInfo('v1.1')
    let specific = makeTagInfo('v1.1.0')

    let result = findCompatibleTags([floating, specific], 'v1.0.0', {
      mode: 'minor',
    })

    expect(result).toStrictEqual([specific, floating])
  })

  it.each<[string, UpdateMode, string]>([
    ['v5.0.0', 'minor', 'a newer major'],
    ['v4.3.0', 'patch', 'a newer minor'],
    ['v5.2.0', 'patch', 'a newer major with the same minor'],
  ])('skips %s in %s mode for the current v4.2.2 as %s', (tag, mode) => {
    let result = findCompatibleTags([makeTagInfo(tag)], 'v4.2.2', { mode })

    expect(result).toStrictEqual([])
  })

  it.each(['stable', 'v4.2.5.1'])(
    'ignores the tag %s that carries no comparable version',
    tag => {
      let tags = [makeTagInfo(tag), makeTagInfo('v4.2.1')]

      let result = findCompatibleTags(tags, 'v4.2.0', { mode: 'patch' })

      expect(result.map(({ tag: name }) => name)).toStrictEqual(['v4.2.1'])
    },
  )

  it.each<[UpdateMode, string[]]>([
    ['patch', ['actions-v0.1.2']],
    ['minor', ['actions-v0.2.0', 'actions-v0.1.2']],
  ])('ranks members of a prefixed family in %s mode', (mode, expected) => {
    let tags = [
      makeTagInfo('actions-v0.1.2'),
      makeTagInfo('actions-v0.2.0'),
      makeTagInfo('v0.9.9'),
    ]

    let result = findCompatibleTags(tags, 'actions-v0.1.1', { mode })

    expect(result.map(({ tag }) => tag)).toStrictEqual(expected)
  })

  it('never crosses into another tag family', () => {
    let result = findCompatibleTags([makeTagInfo('v0.9.9')], 'actions-v0.1.1', {
      mode: 'minor',
    })

    expect(result).toStrictEqual([])
  })

  it('skips prereleases when the current version is stable', () => {
    let tags = [makeTagInfo('v4.1.0-rc.1'), makeTagInfo('v4.0.1')]

    let result = findCompatibleTags(tags, 'v4.0.0', { mode: 'minor' })

    expect(result.map(({ tag }) => tag)).toStrictEqual(['v4.0.1'])
  })

  it('keeps prereleases when the current version is a prerelease', () => {
    let tags = [makeTagInfo('v4.1.0-rc.2'), makeTagInfo('v4.0.1')]

    let result = findCompatibleTags(tags, 'v4.0.0-rc.1', { mode: 'minor' })

    expect(result.map(({ tag }) => tag)).toStrictEqual([
      'v4.1.0-rc.2',
      'v4.0.1',
    ])
  })

  it('ignores tags above the vetted latest version', () => {
    let tags = [
      makeTagInfo('v5.0.0'),
      makeTagInfo('v4.3.0'),
      makeTagInfo('v4.2.0'),
    ]

    let result = findCompatibleTags(tags, 'v4.1.0', {
      latestVersion: 'v4.3.0',
      mode: 'major',
    })

    expect(result.map(({ tag }) => tag)).toStrictEqual(['v4.3.0', 'v4.2.0'])
  })

  it('ranks every compatible tag when the latest version carries no core', () => {
    let tags = [makeTagInfo('v5.0.0'), makeTagInfo('v4.3.0')]

    let result = findCompatibleTags(tags, 'v4.1.0', {
      latestVersion: 'main',
      mode: 'major',
    })

    expect(result.map(({ tag }) => tag)).toStrictEqual(['v5.0.0', 'v4.3.0'])
  })
})
