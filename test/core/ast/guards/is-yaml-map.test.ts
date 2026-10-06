import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isYAMLMap } from '../../../../core/ast/guards/is-yaml-map'

describe('isYAMLMap', () => {
  it.each([
    [true, 'a map parsed from YAML', parseDocument('name: CI\n').contents],
    [false, 'an object whose items are not a list', { items: 'name: CI' }],
    [false, 'an object without items', { value: 'CI' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'name: CI'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [false, 'an array', []],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(isYAMLMap(node)).toBe(expected)
  })

  describe('current behavior pending owner decision', () => {
    it('accepts a sequence parsed from YAML as a map', () => {
      let sequence = parseDocument('- actions/checkout@v4\n').contents

      expect(isYAMLMap(sequence)).toBeTruthy()
    })
  })
})
