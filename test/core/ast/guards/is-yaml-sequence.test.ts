import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isYAMLSequence } from '../../../../core/ast/guards/is-yaml-sequence'

describe('isYAMLSequence', () => {
  it.each([
    [
      true,
      'a sequence parsed from YAML',
      parseDocument('- actions/checkout@v4\n').contents,
    ],
    [
      false,
      'an object whose items are not a list',
      { items: 'actions/checkout@v4' },
    ],
    [false, 'an object without items', { value: 'actions/checkout@v4' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', '- actions/checkout@v4'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [false, 'an array', []],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(isYAMLSequence(node)).toBe(expected)
  })

  describe('current behavior pending owner decision', () => {
    it('accepts a map parsed from YAML as a sequence', () => {
      let map = parseDocument('name: CI\n').contents

      expect(isYAMLSequence(map)).toBeTruthy()
    })
  })
})
