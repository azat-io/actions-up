import { describe, expect, it } from 'vitest'

import { compareSha } from '../../../core/versions/compare-sha'

const FULL_SHA = '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'
const SHORT_SHA = '3b1f9d7'

describe('compareSha', () => {
  it.each([
    ['identical full SHAs', FULL_SHA, FULL_SHA],
    ['a short SHA and the full SHA it abbreviates', SHORT_SHA, FULL_SHA],
    ['a full SHA and its abbreviation', FULL_SHA, SHORT_SHA],
    ['an uppercase short SHA and a lowercase full SHA', '3B1F9D7', FULL_SHA],
    [
      'a short SHA and an uppercase full SHA',
      SHORT_SHA,
      '3B1F9D770A89FFB6BBCF07A1C78A6F2C564AB1C2',
    ],
    ['a v-prefixed short SHA and a full SHA', `v${SHORT_SHA}`, FULL_SHA],
    ['a full SHA and a v-prefixed short SHA', FULL_SHA, `v${SHORT_SHA}`],
  ])('treats %s as the same commit', (_description, sha1, sha2) => {
    expect(compareSha(sha1, sha2)).toBeTruthy()
  })

  it.each([
    [
      'full SHAs that differ at the first character',
      FULL_SHA,
      '4b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2',
    ],
    [
      'full SHAs that differ only at the last character',
      FULL_SHA,
      '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c3',
    ],
    [
      'full SHAs that share only the minimum SHA length',
      FULL_SHA,
      '3b1f9d7ab12cd34ef56ab12cd34ef56ab12cd34e',
    ],
    [
      'a short SHA that differs from the full SHA at its last character',
      '3b1f9d8',
      FULL_SHA,
    ],
    [
      'a full SHA and a short SHA that differs at its last character',
      FULL_SHA,
      '3b1f9d8',
    ],
  ])('tells apart %s', (_description, sha1, sha2) => {
    expect(compareSha(sha1, sha2)).toBeFalsy()
  })

  it.each([
    ['a prefix of the full SHA', '3b1f9d', FULL_SHA],
    ['a prefix of the full SHA passed second', FULL_SHA, '3b1f9d'],
    ['identical values once their v is stripped', 'v3b1f9d', 'v3b1f9d'],
  ])(
    'returns false below the minimum SHA length for %s',
    (_description, sha1, sha2) => {
      expect(compareSha(sha1, sha2)).toBeFalsy()
    },
  )
})
