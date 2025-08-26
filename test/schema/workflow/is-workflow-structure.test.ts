import { describe, expect, it } from 'vitest'

import type { WorkflowStructure } from '../../../types/workflow-structure'

import { isWorkflowStructure } from '../../../core/schema/workflow/is-workflow-structure'

describe('isWorkflowStructure', () => {
  it('returns true for valid workflow structures', () => {
    expect(
      isWorkflowStructure({
        jobs: {
          test: {
            'runs-on': 'ubuntu-latest',
            steps: [],
          },
        },
        name: 'CI',
        on: 'push',
      }),
    ).toBeTruthy()
  })

  it('returns true for minimal workflow objects', () => {
    expect(isWorkflowStructure({})).toBeFalsy()
    expect(isWorkflowStructure({ jobs: {} })).toBeTruthy()
    expect(isWorkflowStructure({ name: 'Test' })).toBeTruthy()
    expect(isWorkflowStructure({ on: 'push' })).toBeTruthy()
  })

  it('returns true for workflows with various properties', () => {
    expect(
      isWorkflowStructure({
        on: { push: { branches: ['main'] } },
        env: { NODE_VERSION: '18' },
        name: 'Deploy',
        jobs: {},
      }),
    ).toBeTruthy()
  })

  it('returns false for non-objects', () => {
    expect(isWorkflowStructure(null)).toBeFalsy()
    expect(isWorkflowStructure(undefined)).toBeFalsy()
    expect(isWorkflowStructure('string')).toBeFalsy()
    expect(isWorkflowStructure(123)).toBeFalsy()
    expect(isWorkflowStructure(true)).toBeFalsy()
    expect(isWorkflowStructure([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = {
      jobs: { build: { 'runs-on': 'ubuntu-latest' } },
      name: 'Test Workflow',
    }
    let result = isWorkflowStructure(value)
    expect(result).toBeTruthy()
    let typedValue = value as WorkflowStructure
    expect(typedValue.name).toBe('Test Workflow')
    expect(typedValue.jobs).toBeDefined()
  })

  it('handles workflows with additional properties', () => {
    let workflow = {
      defaults: { run: { shell: 'bash' } },
      permissions: { contents: 'read' },
      concurrency: { group: 'deploy' },
      on: 'workflow_dispatch',
      name: 'Complex',
      jobs: {},
    }
    expect(isWorkflowStructure(workflow)).toBeTruthy()
  })
})
