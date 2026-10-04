import type { YAMLMap } from 'yaml'

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isScalar } from '../../../core/ast/guards/is-scalar'

describe('isScalar', () => {
  it.each([
    [
      true,
      'a scalar parsed from YAML',
      parseDocument('name: CI\n').get('name', true),
    ],
    [
      true,
      'a scalar parsed from an empty value',
      parseDocument('name:\n').get('name', true),
    ],
    [false, 'an object without a value', { key: 'name' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'CI'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [false, 'an array', []],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(isScalar(node)).toBe(expected)
  })

  describe('current behavior pending owner decision', () => {
    it('accepts a map entry parsed from YAML as a scalar', () => {
      let pair = parseDocument<YAMLMap.Parsed>('name: CI\n').contents?.items[0]

      expect(isScalar(pair)).toBeTruthy()
    })
  })
})
