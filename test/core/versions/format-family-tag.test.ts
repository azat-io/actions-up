import { describe, expect, it } from 'vitest'

import type { TagFamily } from '../../../types/tag-family'

import { formatFamilyTag } from '../../../core/versions/format-family-tag'

/**
 * Build a parsed tag family. Its own core differs from every segment list the
 * tests pass, so a tag can only come out right when it is built from the given
 * segments.
 *
 * @param overrides - Fields that differ from the defaults.
 * @returns Fresh tag family.
 */
function makeTagFamily(overrides: Partial<TagFamily> = {}): TagFamily {
  return {
    version: '4.5.6',
    specificity: 3,
    qualifier: '',
    core: '4.5.6',
    prefix: 'v',
    ...overrides,
  }
}

describe('formatFamilyTag', () => {
  it.each([
    ['actions-v', ['0'], 'actions-v0'],
    ['actions-v', ['0', '1'], 'actions-v0.1'],
    ['actions-v', ['0', '1', '2'], 'actions-v0.1.2'],
    ['v', ['7'], 'v7'],
    ['v', ['7', '0'], 'v7.0'],
    ['', ['1', '2', '3'], '1.2.3'],
    ['@scope/pkg@', ['1', '2'], '@scope/pkg@1.2'],
  ])(
    'joins the prefix %j with the segments %j',
    (prefix, segments, expected) => {
      expect(formatFamilyTag(makeTagFamily({ prefix }), segments)).toBe(
        expected,
      )
    },
  )
})
