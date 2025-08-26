import { describe, expect, it } from 'vitest'

import type { WorkflowJob } from '../../../types/workflow-job'

import { isWorkflowJob } from '../../../core/schema/workflow/is-workflow-job'

describe('isWorkflowJob', () => {
  it('returns true for valid workflow jobs', () => {
    expect(
      isWorkflowJob({
        steps: [{ uses: 'actions/checkout@v4' }, { run: 'npm test' }],
        'runs-on': 'ubuntu-latest',
      }),
    ).toBeTruthy()
  })

  it('returns true for minimal job objects', () => {
    expect(isWorkflowJob({})).toBeFalsy()
    expect(isWorkflowJob({ 'runs-on': 'ubuntu-latest' })).toBeTruthy()
    expect(isWorkflowJob({ steps: [] })).toBeTruthy()
    expect(
      isWorkflowJob({ uses: 'owner/repo/.github/workflows/reusable.yml@main' }),
    ).toBeTruthy()
    expect(isWorkflowJob({ container: 'node:18' })).toBeTruthy()
  })

  it('returns true for jobs with various configurations', () => {
    expect(
      isWorkflowJob({
        'runs-on': ['ubuntu-latest', 'windows-latest'],
        if: "github.event_name == 'push'",
        env: { NODE_ENV: 'test' },
        'timeout-minutes': 30,
        needs: 'build',
        steps: [],
      }),
    ).toBeTruthy()
  })

  it('returns true for jobs with matrix strategy', () => {
    expect(
      isWorkflowJob({
        strategy: {
          matrix: {
            os: ['ubuntu-latest', 'macos-latest'],
            node: [16, 18],
          },
        },
        'runs-on': ['$', '{{', ' matrix.os ', '}}'].join(''),
        steps: [],
      }),
    ).toBeTruthy()
  })

  it('returns false for non-objects', () => {
    expect(isWorkflowJob(null)).toBeFalsy()
    expect(isWorkflowJob(undefined)).toBeFalsy()
    expect(isWorkflowJob('string')).toBeFalsy()
    expect(isWorkflowJob(123)).toBeFalsy()
    expect(isWorkflowJob(true)).toBeFalsy()
    expect(isWorkflowJob([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = {
      steps: [{ run: 'echo "Hello"' }],
      'runs-on': 'ubuntu-latest',
      needs: ['test', 'lint'],
    }
    let result = isWorkflowJob(value)
    expect(result).toBeTruthy()
    let typedValue = value as WorkflowJob
    expect(typedValue['runs-on']).toBe('ubuntu-latest')
    expect(typedValue.needs).toEqual(['test', 'lint'])
    expect(typedValue.steps).toBeDefined()
  })

  it('handles jobs with container configuration', () => {
    let job = {
      container: {
        env: { NODE_ENV: 'production' },
        image: 'node:18',
      },
      services: {
        postgres: {
          image: 'postgres:14',
        },
      },
      'runs-on': 'ubuntu-latest',
      steps: [],
    }
    expect(isWorkflowJob(job)).toBeTruthy()
  })
})
