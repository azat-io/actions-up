import { describe, expect, it } from 'vitest'

import { isCompositeActionRuns } from '../../../../core/schema/composite/is-composite-action-runs'

describe('isCompositeActionRuns', () => {
  it.each([
    [
      true,
      'runs with a using key',
      { steps: [{ uses: 'actions/checkout@v4' }], using: 'composite' },
    ],
    [
      false,
      'runs without a using key',
      { steps: [{ uses: 'actions/checkout@v4' }] },
    ],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'composite'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [
      false,
      'an array that carries a using key',
      Object.assign([], { using: 'composite' }),
    ],
  ])('returns %s for %s', (expected, _description, value) => {
    expect(isCompositeActionRuns(value)).toBe(expected)
  })

  describe('current behavior pending owner decision', () => {
    it.each([
      ['a node', { main: 'dist/index.js', using: 'node20' }],
      ['a docker', { image: 'Dockerfile', using: 'docker' }],
    ])('accepts the runs of %s action as composite runs', (_kind, value) => {
      expect(isCompositeActionRuns(value)).toBeTruthy()
    })
  })
})
