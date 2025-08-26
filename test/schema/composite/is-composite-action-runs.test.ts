import { describe, expect, it } from 'vitest'

import type { CompositeActionRuns } from '../../../types/composite-action-runs'

import { isCompositeActionRuns } from '../../../core/schema/composite/is-composite-action-runs'

describe('isCompositeActionRuns', () => {
  it('returns true for valid composite action runs configuration', () => {
    expect(
      isCompositeActionRuns({
        steps: [{ run: 'echo "Hello"' }, { uses: 'actions/checkout@v4' }],
        using: 'composite',
      }),
    ).toBeTruthy()
  })

  it('returns true for minimal runs objects', () => {
    expect(isCompositeActionRuns({})).toBeFalsy()
    expect(isCompositeActionRuns({ using: 'composite' })).toBeTruthy()
    expect(isCompositeActionRuns({ steps: [] })).toBeFalsy()
    expect(
      isCompositeActionRuns({ using: 'composite', steps: [] }),
    ).toBeTruthy()
  })

  it('returns true for runs with pre and post scripts', () => {
    expect(
      isCompositeActionRuns({
        'pre-if': 'runner.os == "Linux"',
        steps: [{ run: 'main.sh' }],
        'post-if': 'always()',
        using: 'composite',
        post: 'cleanup.sh',
        pre: 'setup.sh',
      }),
    ).toBeTruthy()
  })

  it('returns true for node action runs', () => {
    expect(
      isCompositeActionRuns({
        post: 'dist/cleanup.js',
        main: 'dist/index.js',
        pre: 'dist/setup.js',
        using: 'node20',
      }),
    ).toBeTruthy()
  })

  it('returns true for docker action runs', () => {
    expect(
      isCompositeActionRuns({
        args: [
          ['$', '{{', ' inputs.arg1 ', '}}'].join(''),
          ['$', '{{', ' inputs.arg2 ', '}}'].join(''),
        ],
        env: {
          MY_VAR: 'value',
        },
        image: 'Dockerfile',
        using: 'docker',
      }),
    ).toBeTruthy()
  })

  it('returns false for non-objects', () => {
    expect(isCompositeActionRuns(null)).toBeFalsy()
    expect(isCompositeActionRuns(undefined)).toBeFalsy()
    expect(isCompositeActionRuns('string')).toBeFalsy()
    expect(isCompositeActionRuns(123)).toBeFalsy()
    expect(isCompositeActionRuns(true)).toBeFalsy()
    expect(isCompositeActionRuns([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = {
      steps: [
        { run: 'echo "Step 1"', name: 'Step 1' },
        { uses: 'actions/setup-node@v4', name: 'Step 2' },
      ],
      using: 'composite',
    }
    let result = isCompositeActionRuns(value)
    expect(result).toBeTruthy()
    let typedValue = value as CompositeActionRuns
    expect(typedValue.using).toBe('composite')
    expect(typedValue.steps).toBeDefined()
  })
})
