import { describe, expect, it } from 'vitest'

import type { TagInfo } from '../../types/tag-info'

import { selectLatestSemverTag } from '../../core/versions/select-latest-semver-tag'

describe('selectLatestSemverTag', () => {
  function tag(name: string): TagInfo {
    return { sha: `sha-${name}`, message: null, date: null, tag: name }
  }

  it('returns null when there is nothing to choose from', () => {
    expect(selectLatestSemverTag([])).toBeNull()
    expect(selectLatestSemverTag([tag('main'), tag('nightly')])).toBeNull()
  })

  it('picks the highest version', () => {
    let tags = [tag('v1.2.3'), tag('v1.10.0'), tag('v1.2.4')]

    expect(selectLatestSemverTag(tags)?.tag.tag).toBe('v1.10.0')
  })

  it('reports the comparable version of the chosen tag', () => {
    expect(selectLatestSemverTag([tag('v6')])).toEqual({
      version: '6.0.0',
      tag: tag('v6'),
    })
  })

  it('prefers the more specific tag among equal versions', () => {
    expect(selectLatestSemverTag([tag('v6'), tag('v6.0.0')])?.tag.tag).toBe(
      'v6.0.0',
    )
    expect(selectLatestSemverTag([tag('v6.0.0'), tag('v6')])?.tag.tag).toBe(
      'v6.0.0',
    )
  })

  it('ignores tags that carry no version', () => {
    let tags = [tag('latest'), tag('v1.2.3'), tag('actions-v2.0.0')]

    expect(selectLatestSemverTag(tags)?.tag.tag).toBe('v1.2.3')
  })

  /**
   * An eight-digit calendar tag is valid hexadecimal, so it survives the
   * semver-like check but carries no comparable version. Comparing it throws,
   * which used to fail the whole repository lookup.
   */
  it('ignores SHA-shaped numeric tags', () => {
    expect(selectLatestSemverTag([tag('20240101')])).toBeNull()
    expect(selectLatestSemverTag([tag('v20240101')])).toBeNull()
    expect(
      selectLatestSemverTag([tag('v1.2.3'), tag('20240101'), tag('v1.2.4')])
        ?.tag.tag,
    ).toBe('v1.2.4')
  })
})
