import { describe, expect, it } from 'vitest'

import type { CompositeActionStructure } from '../../../types/composite-action-structure'

import { isCompositeActionStructure } from '../../../core/schema/composite/is-composite-action-structure'

describe('isCompositeActionStructure', () => {
  it('returns true for valid composite action structures', () => {
    expect(
      isCompositeActionStructure({
        inputs: {
          token: {
            default: ['$', '{{', ' github.token ', '}}'].join(''),
            description: 'GitHub token',
            required: true,
          },
        },
        outputs: {
          result: {
            value: ['$', '{{', ' steps.main.outputs.result ', '}}'].join(''),
            description: 'The result',
          },
        },
        runs: {
          using: 'composite',
          steps: [],
        },
        description: 'A composite action',
        name: 'My Action',
      }),
    ).toBeTruthy()
  })

  it('returns true for minimal action objects', () => {
    expect(isCompositeActionStructure({})).toBeFalsy()
    expect(isCompositeActionStructure({ name: 'Simple Action' })).toBeTruthy()
    expect(isCompositeActionStructure({ description: 'Test' })).toBeTruthy()
    expect(
      isCompositeActionStructure({ runs: { using: 'composite', steps: [] } }),
    ).toBeTruthy()
  })

  it('returns true for actions with various configurations', () => {
    expect(
      isCompositeActionStructure({
        branding: {
          icon: 'activity',
          color: 'blue',
        },
        runs: {
          using: 'composite',
          steps: [],
        },
        description: 'Does complex things',
        name: 'Complex Action',
        author: 'Test Author',
        outputs: {},
        inputs: {},
      }),
    ).toBeTruthy()
  })

  it('returns false for non-objects', () => {
    expect(isCompositeActionStructure(null)).toBeFalsy()
    expect(isCompositeActionStructure(undefined)).toBeFalsy()
    expect(isCompositeActionStructure('string')).toBeFalsy()
    expect(isCompositeActionStructure(123)).toBeFalsy()
    expect(isCompositeActionStructure(true)).toBeFalsy()
    expect(isCompositeActionStructure([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = {
      inputs: { param: { description: 'A parameter' } },
      description: 'Testing type guard',
      runs: { using: 'composite' },
      name: 'Test Action',
    }
    let result = isCompositeActionStructure(value)
    expect(result).toBeTruthy()
    let typedValue = value as CompositeActionStructure
    expect(typedValue.name).toBe('Test Action')
    expect(typedValue.description).toBe('Testing type guard')
    expect(typedValue.inputs).toBeDefined()
    expect(typedValue.runs).toBeDefined()
  })
})
