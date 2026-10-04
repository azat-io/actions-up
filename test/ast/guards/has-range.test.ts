import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { hasRange } from '../../../core/ast/guards/has-range'

describe('hasRange', () => {
  it.each([
    [
      true,
      'a node parsed from YAML',
      parseDocument('name: CI\n').get('name', true),
    ],
    [true, 'an object whose range is not set', { range: undefined }],
    [false, 'an object without a range', { value: 'name' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'name'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [false, 'an array', []],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(hasRange(node)).toBe(expected)
  })
})
