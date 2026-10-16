import { describe, expect, it } from 'vitest'

import { coerceTagVersion } from '../../../core/versions/coerce-tag-version'

describe('coerceTagVersion', () => {
  it.each([
    ['v1', '1.0.0'],
    ['v1.2', '1.2.0'],
    ['1.2.3', '1.2.3'],
    ['actions-v0.1.1', '0.1.1'],
  ])('coerces %s to %s', (tag, expected) => {
    expect(coerceTagVersion(tag)).toBe(expected)
  })

  it.each([
    ['web3-utils@1.2.3', '1.2.3'],
    ['node20-v1.2.3', '1.2.3'],
    ['@bedrock-rbx/state-s3@0.2.3', '0.2.3'],
  ])(
    'skips the digits of the family name in %s and returns %s',
    (tag, expected) => {
      expect(coerceTagVersion(tag)).toBe(expected)
    },
  )

  it.each([
    ['v1.2.3-rc.1', '1.2.3'],
    ['ci@v1.0.0+build.5', '1.0.0'],
  ])('drops the qualifier of %s and returns %s', (tag, expected) => {
    expect(coerceTagVersion(tag)).toBe(expected)
  })

  it('coerces a four-segment version, which carries no tag family, as a whole', () => {
    expect(coerceTagVersion('1.2.3.4')).toBe('1.2.3')
  })

  it.each(['', 'latest', 'main'])(
    'returns null for %j, which holds no number',
    tag => {
      expect(coerceTagVersion(tag)).toBeNull()
    },
  )
})
