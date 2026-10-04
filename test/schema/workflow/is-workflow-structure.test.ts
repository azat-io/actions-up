import { describe, expect, it } from 'vitest'

import { isWorkflowStructure } from '../../../core/schema/workflow/is-workflow-structure'

describe('isWorkflowStructure', () => {
  it.each([
    [true, 'an object with an on key', { on: 'push' }],
    [true, 'an object with a name key', { name: 'CI' }],
    [
      true,
      'an object with a jobs key',
      { jobs: { build: { 'runs-on': 'ubuntu-24.04' } } },
    ],
    [
      false,
      'an object with none of on, name or jobs',
      { env: { NODE_VERSION: '22' } },
    ],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'on: push'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [
      false,
      'an array that carries an on key',
      Object.assign([], { on: 'push' }),
    ],
  ])('returns %s for %s', (expected, _description, value) => {
    expect(isWorkflowStructure(value)).toBe(expected)
  })
})
