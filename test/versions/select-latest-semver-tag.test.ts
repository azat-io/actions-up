import { describe, expect, it } from 'vitest'

import { selectLatestSemverTag } from '../../core/versions/select-latest-semver-tag'
import { makeTagInfo } from '../helpers/make-tag-info'

describe('selectLatestSemverTag', () => {
  it('returns null when there is nothing to choose from', () => {
    expect(selectLatestSemverTag([])).toBeNull()
    expect(
      selectLatestSemverTag([makeTagInfo('main'), makeTagInfo('nightly')]),
    ).toBeNull()
  })

  it('picks the highest version', () => {
    let tags = [
      makeTagInfo('v1.2.3'),
      makeTagInfo('v1.10.0'),
      makeTagInfo('v1.2.4'),
    ]

    expect(selectLatestSemverTag(tags)?.tag.tag).toBe('v1.10.0')
  })

  it('reports the comparable version of the chosen tag', () => {
    let floating = makeTagInfo('v6', {
      sha: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    })

    expect(selectLatestSemverTag([floating])).toStrictEqual({
      version: '6.0.0',
      tag: floating,
    })
  })

  it('prefers a full version over a bare major tag of the same version', () => {
    let bareMajor = makeTagInfo('v6')
    let fullVersion = makeTagInfo('v6.0.0')

    expect(selectLatestSemverTag([bareMajor, fullVersion])?.tag).toBe(
      fullVersion,
    )
    expect(selectLatestSemverTag([fullVersion, bareMajor])?.tag).toBe(
      fullVersion,
    )
  })

  it('ignores tags that carry no version', () => {
    let tags = [
      makeTagInfo('latest'),
      makeTagInfo('v1.2.3'),
      makeTagInfo('actions-v2.0.0'),
    ]

    expect(selectLatestSemverTag(tags)?.tag.tag).toBe('v1.2.3')
  })

  /**
   * An eight-digit calendar tag is valid hexadecimal, so it survives the
   * semver-like check but carries no comparable version. Comparing it throws,
   * which used to fail the whole repository lookup.
   */
  it('ignores SHA-shaped numeric tags', () => {
    expect(selectLatestSemverTag([makeTagInfo('20240101')])).toBeNull()
    expect(selectLatestSemverTag([makeTagInfo('v20240101')])).toBeNull()
    expect(
      selectLatestSemverTag([
        makeTagInfo('v1.2.3'),
        makeTagInfo('20240101'),
        makeTagInfo('v1.2.4'),
      ])?.tag.tag,
    ).toBe('v1.2.4')
  })
})
