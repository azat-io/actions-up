import { describe, expect, it } from 'vitest'

import type { TagInfo } from '../../types/tag-info'

import { selectLatestFamilyTag } from '../../core/versions/select-latest-family-tag'
import { makeTagInfo } from '../helpers/make-tag-info'

/**
 * Build the tags of a repository that publishes three tag families at once: an
 * action under `actions-v`, npm releases under `v` and a scoped package whose
 * newest version is ahead of both.
 *
 * @returns Fresh list of tag entries.
 */
function makeMultiFamilyTags(): TagInfo[] {
  return [
    makeTagInfo('actions-v0'),
    makeTagInfo('actions-v0.1.0'),
    makeTagInfo('actions-v0.1.1'),
    makeTagInfo('v0.2.0'),
    makeTagInfo('v0.2.3'),
    makeTagInfo('@bedrock-rbx/core@0.3.0'),
  ]
}

describe('selectLatestFamilyTag', () => {
  it.each(['main', 'nightly', '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8'])(
    'returns null when the reference %s has no family',
    reference => {
      expect(selectLatestFamilyTag(makeMultiFamilyTags(), reference)).toBeNull()
    },
  )

  it('returns null when no tag shares the family', () => {
    expect(
      selectLatestFamilyTag(makeMultiFamilyTags(), 'deploy-v1.0.0'),
    ).toBeNull()
    expect(selectLatestFamilyTag([], 'actions-v0.1.1')).toBeNull()
  })

  it.each([
    ['actions-v0.1.1', 'actions-v0.1.1'],
    ['v0.2.0', 'v0.2.3'],
  ])(
    'answers %s with %s although another family has a newer version',
    (reference, expected) => {
      expect(selectLatestFamilyTag(makeMultiFamilyTags(), reference)?.tag).toBe(
        expected,
      )
    },
  )

  it('picks the newest member of the family', () => {
    let tags = [...makeMultiFamilyTags(), makeTagInfo('actions-v0.1.2')]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.1')?.tag).toBe(
      'actions-v0.1.2',
    )
  })

  it('prefers the more specific tag among equal versions', () => {
    let floating = makeTagInfo('actions-v0.1')
    let specific = makeTagInfo('actions-v0.1.0')

    expect(selectLatestFamilyTag([floating, specific], 'actions-v0.1.0')).toBe(
      specific,
    )
    expect(selectLatestFamilyTag([specific, floating], 'actions-v0.1.0')).toBe(
      specific,
    )
  })

  it('skips tags it cannot parse', () => {
    let tags = [
      makeTagInfo('actions-v0.1.0'),
      makeTagInfo('actions-nightly'),
      makeTagInfo('main'),
    ]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.0')?.tag).toBe(
      'actions-v0.1.0',
    )
  })

  it('ignores prereleases for a stable reference', () => {
    let tags = [
      makeTagInfo('actions-v0.1.1'),
      makeTagInfo('actions-v0.2.0-rc.1'),
    ]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.1')?.tag).toBe(
      'actions-v0.1.1',
    )
  })

  it('keeps prereleases for a prerelease reference', () => {
    let tags = [
      makeTagInfo('actions-v0.1.1'),
      makeTagInfo('actions-v0.2.0-rc.2'),
    ]

    expect(selectLatestFamilyTag(tags, 'actions-v0.2.0-rc.1')?.tag).toBe(
      'actions-v0.2.0-rc.2',
    )
  })

  it('treats a v prefix as the same family', () => {
    let tags = [makeTagInfo('v1.2.0'), makeTagInfo('1.3.0')]

    expect(selectLatestFamilyTag(tags, 'v1.2.0')?.tag).toBe('1.3.0')
  })
})
