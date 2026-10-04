import { describe, expect, it } from 'vitest'

import { isCompositeActionStructure } from '../../../core/schema/composite/is-composite-action-structure'

describe('isCompositeActionStructure', () => {
  it.each([
    [true, 'an object with a name key', { name: 'Setup' }],
    [
      true,
      'an object with a description key',
      { description: 'Installs the toolchain' },
    ],
    [
      true,
      'an object with a runs key',
      { runs: { using: 'composite', steps: [] } },
    ],
    [
      false,
      'an object with none of name, description or runs',
      { inputs: { token: { required: true } } },
    ],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'name: Setup'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [
      false,
      'an array that carries a name key',
      Object.assign([], { name: 'Setup' }),
    ],
  ])('returns %s for %s', (expected, _description, value) => {
    expect(isCompositeActionStructure(value)).toBe(expected)
  })
})
