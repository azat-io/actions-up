import { describe, expect, it } from 'vitest'

import type { TagInfo } from '../../types/tag-info'

import { selectLatestFamilyTag } from '../../core/versions/select-latest-family-tag'

describe('selectLatestFamilyTag', () => {
  function tag(name: string): TagInfo {
    return { sha: `sha-${name}`, message: null, date: null, tag: name }
  }

  let bedrockTags = [
    tag('actions-v0'),
    tag('actions-v0.1.0'),
    tag('actions-v0.1.1'),
    tag('v0.2.0'),
    tag('v0.2.3'),
    tag('@bedrock-rbx/core@0.2.3'),
  ]

  it('returns null when the reference has no family', () => {
    expect(selectLatestFamilyTag(bedrockTags, 'main')).toBeNull()
    expect(selectLatestFamilyTag(bedrockTags, 'nightly')).toBeNull()
    expect(
      selectLatestFamilyTag(
        bedrockTags,
        '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      ),
    ).toBeNull()
  })

  it('returns null when no tag shares the family', () => {
    expect(selectLatestFamilyTag(bedrockTags, 'deploy-v1.0.0')).toBeNull()
    expect(selectLatestFamilyTag([], 'actions-v0.1.1')).toBeNull()
  })

  it('ignores tags from other families', () => {
    expect(selectLatestFamilyTag(bedrockTags, 'actions-v0.1.1')?.tag).toBe(
      'actions-v0.1.1',
    )
    expect(selectLatestFamilyTag(bedrockTags, 'v0.2.0')?.tag).toBe('v0.2.3')
  })

  it('picks the newest member of the family', () => {
    let tags = [...bedrockTags, tag('actions-v0.1.2')]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.1')?.tag).toBe(
      'actions-v0.1.2',
    )
  })

  it('prefers the more specific tag among equal versions', () => {
    let tags = [tag('actions-v0.1'), tag('actions-v0.1.0')]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.0')?.tag).toBe(
      'actions-v0.1.0',
    )
    expect(
      selectLatestFamilyTag(tags.toReversed(), 'actions-v0.1.0')?.tag,
    ).toBe('actions-v0.1.0')
  })

  it('skips tags it cannot parse', () => {
    let tags = [tag('actions-v0.1.0'), tag('actions-nightly'), tag('main')]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.0')?.tag).toBe(
      'actions-v0.1.0',
    )
  })

  it('ignores prereleases for a stable reference', () => {
    let tags = [tag('actions-v0.1.1'), tag('actions-v0.2.0-rc.1')]

    expect(selectLatestFamilyTag(tags, 'actions-v0.1.1')?.tag).toBe(
      'actions-v0.1.1',
    )
  })

  it('keeps prereleases for a prerelease reference', () => {
    let tags = [tag('actions-v0.1.1'), tag('actions-v0.2.0-rc.2')]

    expect(selectLatestFamilyTag(tags, 'actions-v0.2.0-rc.1')?.tag).toBe(
      'actions-v0.2.0-rc.2',
    )
  })

  it('treats a v prefix as the same family', () => {
    let tags = [tag('v1.2.0'), tag('1.3.0')]

    expect(selectLatestFamilyTag(tags, 'v1.2.0')?.tag).toBe('1.3.0')
  })
})
