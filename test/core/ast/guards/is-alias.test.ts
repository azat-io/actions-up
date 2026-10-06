import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isAlias } from '../../../../core/ast/guards/is-alias'

describe('isAlias', () => {
  it.each([
    [
      true,
      'an alias parsed from YAML',
      parseDocument('first: &step 1\nsecond: *step\n').get('second', true),
    ],
    [
      false,
      'the node its anchor defines',
      parseDocument('first: &step 1\nsecond: *step\n').get('first', true),
    ],
    [false, 'a map parsed from YAML', parseDocument('name: CI\n').contents],
    [false, 'an object whose resolve is not a function', { resolve: 'step' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', '*step'],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(isAlias(node)).toBe(expected)
  })
})
