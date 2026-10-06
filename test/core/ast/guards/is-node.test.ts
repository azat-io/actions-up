import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isNode } from '../../../../core/ast/guards/is-node'

describe('isNode', () => {
  it.each([
    [true, 'a node parsed from YAML', parseDocument('name: CI\n').contents],
    [false, 'an object without toJSON', { value: 'CI' }],
    [false, 'an object whose toJSON is not a function', { toJSON: 'CI' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'name: CI'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [false, 'an array', []],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(isNode(node)).toBe(expected)
  })
})
