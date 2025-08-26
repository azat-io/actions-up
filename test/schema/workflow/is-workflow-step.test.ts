import { describe, expect, it } from 'vitest'

import type { WorkflowStep } from '../../../types/workflow-step'

import { isWorkflowStep } from '../../../core/schema/workflow/is-workflow-step'

describe('isWorkflowStep', () => {
  it('returns true for valid workflow steps with uses', () => {
    expect(
      isWorkflowStep({
        uses: 'actions/checkout@v4',
        with: { 'fetch-depth': 0 },
        name: 'Checkout code',
      }),
    ).toBeTruthy()
  })

  it('returns true for valid workflow steps with run', () => {
    expect(
      isWorkflowStep({
        env: { NODE_ENV: 'test' },
        name: 'Run tests',
        run: 'npm test',
      }),
    ).toBeTruthy()
  })

  it('returns true for minimal step objects', () => {
    expect(isWorkflowStep({})).toBeFalsy()
    expect(isWorkflowStep({ uses: 'actions/setup-node@v4' })).toBeTruthy()
    expect(isWorkflowStep({ run: 'echo "Hello"' })).toBeTruthy()
  })

  it('returns true for steps with various configurations', () => {
    expect(
      isWorkflowStep({
        with: {
          // eslint-disable-next-line no-template-curly-in-string
          key: '${{ runner.os }}-node-${{ hashFiles("**/package-lock.json") }}',
          path: 'node_modules',
        },
        env: {
          CACHE_VERSION: '1',
        },
        'continue-on-error': true,
        uses: 'actions/cache@v3',
        id: 'cache-node-modules',
        'timeout-minutes': 10,
        name: 'Complex step',
        if: 'success()',
      }),
    ).toBeTruthy()
  })

  it('returns true for steps with shell configuration', () => {
    expect(
      isWorkflowStep({
        'working-directory': './src',
        name: 'Run script',
        run: 'echo $SHELL',
        shell: 'bash',
      }),
    ).toBeTruthy()
  })

  it('returns false for non-objects', () => {
    expect(isWorkflowStep(null)).toBeFalsy()
    expect(isWorkflowStep(undefined)).toBeFalsy()
    expect(isWorkflowStep('string')).toBeFalsy()
    expect(isWorkflowStep(123)).toBeFalsy()
    expect(isWorkflowStep(true)).toBeFalsy()
    expect(isWorkflowStep([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = {
      with: { 'node-version': '18' },
      uses: 'actions/setup-node@v4',
      name: 'Setup Node',
    }
    let result = isWorkflowStep(value)
    expect(result).toBeTruthy()
    let typedValue = value as WorkflowStep
    expect(typedValue.name).toBe('Setup Node')
    expect(typedValue.uses).toBe('actions/setup-node@v4')
    expect(typedValue.with).toEqual({ 'node-version': '18' })
  })
})
