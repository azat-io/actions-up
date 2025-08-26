import { describe, expect, it } from 'vitest'

import type { CompositeActionStep } from '../../../types/composite-action-step'

import { isCompositeActionStep } from '../../../core/schema/composite/is-composite-action-step'

describe('isCompositeActionStep', () => {
  it('returns true for valid composite action steps with uses', () => {
    expect(
      isCompositeActionStep({
        uses: 'actions/checkout@v4',
        with: { 'fetch-depth': 0 },
        name: 'Checkout code',
      }),
    ).toBeTruthy()
  })

  it('returns true for valid composite action steps with run', () => {
    expect(
      isCompositeActionStep({
        run: 'echo "Hello from composite action"',
        name: 'Run script',
        shell: 'bash',
      }),
    ).toBeTruthy()
  })

  it('returns true for minimal step objects', () => {
    expect(isCompositeActionStep({})).toBeFalsy()
    expect(
      isCompositeActionStep({ uses: 'actions/setup-node@v4' }),
    ).toBeTruthy()
    expect(isCompositeActionStep({ run: 'npm install' })).toBeTruthy()
  })

  it('returns true for steps with environment variables', () => {
    expect(
      isCompositeActionStep({
        env: {
          NODE_ENV: 'production',
          CI: 'true',
        },
        name: 'Build project',
        run: 'npm run build',
      }),
    ).toBeTruthy()
  })

  it('returns true for steps with working directory', () => {
    expect(
      isCompositeActionStep({
        'working-directory': './packages/core',
        name: 'Test in subdirectory',
        run: 'npm test',
      }),
    ).toBeTruthy()
  })

  it('returns true for steps with id', () => {
    expect(
      isCompositeActionStep({
        run: 'echo "version=$(cat package.json | jq -r .version)" >> $GITHUB_OUTPUT',
        name: 'Get version',
        id: 'get-version',
        shell: 'bash',
      }),
    ).toBeTruthy()
  })

  it('returns false for non-objects', () => {
    expect(isCompositeActionStep(null)).toBeFalsy()
    expect(isCompositeActionStep(undefined)).toBeFalsy()
    expect(isCompositeActionStep('string')).toBeFalsy()
    expect(isCompositeActionStep(123)).toBeFalsy()
    expect(isCompositeActionStep(true)).toBeFalsy()
    expect(isCompositeActionStep([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = {
      env: { NPM_TOKEN: ['$', '{{', ' inputs.npm-token ', '}}'].join('') },
      name: 'Setup environment',
      run: 'npm ci',
    }
    let result = isCompositeActionStep(value)
    expect(result).toBeTruthy()
    let typedValue = value as CompositeActionStep
    expect(typedValue.name).toBe('Setup environment')
    expect(typedValue.run).toBe('npm ci')
    expect(typedValue.env).toBeDefined()
  })
})
