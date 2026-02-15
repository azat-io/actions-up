import { describe, expect, it } from 'vitest'

import type { GitHubAction } from '../../types/github-action'
import type { ScanResult } from '../../types/scan-result'

import { mergeScanResults } from '../../cli/merge-scan-results'

describe('mergeScanResults', () => {
  it('returns empty result for empty array', () => {
    let result = mergeScanResults([])

    expect(result).toEqual({
      compositeActions: new Map(),
      workflows: new Map(),
      actions: [],
    })
  })

  it('merges workflows from multiple results with index prefix', () => {
    let results: ScanResult[] = [
      {
        workflows: new Map([
          ['workflow1.yml', []],
          ['workflow2.yml', []],
        ]),
        compositeActions: new Map(),
        actions: [],
      },
      {
        workflows: new Map([['workflow3.yml', []]]),
        compositeActions: new Map(),
        actions: [],
      },
    ]

    let result = mergeScanResults(results)

    expect(result.workflows.size).toBe(3)
    expect(result.workflows.has('0:workflow1.yml')).toBeTruthy()
    expect(result.workflows.has('0:workflow2.yml')).toBeTruthy()
    expect(result.workflows.has('1:workflow3.yml')).toBeTruthy()
  })

  it('merges composite actions from multiple results', () => {
    let results: ScanResult[] = [
      {
        compositeActions: new Map([
          ['action1', '/path/to/action1'],
          ['action2', '/path/to/action2'],
        ]),
        workflows: new Map(),
        actions: [],
      },
      {
        compositeActions: new Map([['action3', '/path/to/action3']]),
        workflows: new Map(),
        actions: [],
      },
    ]

    let result = mergeScanResults(results)

    expect(result.compositeActions.size).toBe(3)
    expect(result.compositeActions.has('0:/path/to/action1')).toBeTruthy()
    expect(result.compositeActions.has('0:/path/to/action2')).toBeTruthy()
    expect(result.compositeActions.has('1:/path/to/action3')).toBeTruthy()
  })

  it('merges actions from multiple results', () => {
    let action1: GitHubAction = {
      name: 'actions/checkout',
      file: 'workflow1.yml',
      type: 'external',
      version: 'v4',
      line: 10,
    }
    let action2: GitHubAction = {
      name: 'actions/setup-node',
      file: 'workflow2.yml',
      type: 'external',
      version: 'v3',
      line: 15,
    }
    let results: ScanResult[] = [
      {
        compositeActions: new Map(),
        workflows: new Map(),
        actions: [action1],
      },
      {
        compositeActions: new Map(),
        workflows: new Map(),
        actions: [action2],
      },
    ]

    let result = mergeScanResults(results)

    expect(result.actions).toEqual([action1, action2])
  })

  it('deduplicates actions with same file:line:name:version', () => {
    let action1: GitHubAction = {
      name: 'actions/checkout',
      file: 'workflow.yml',
      type: 'external',
      version: 'v4',
      line: 10,
    }
    let action2: GitHubAction = {
      name: 'actions/checkout',
      file: 'workflow.yml',
      type: 'external',
      version: 'v4',
      line: 10,
    }
    let action3: GitHubAction = {
      name: 'actions/checkout',
      file: 'workflow.yml',
      type: 'external',
      version: 'v4',
      line: 20,
    }
    let results: ScanResult[] = [
      {
        actions: [action1, action2, action3],
        compositeActions: new Map(),
        workflows: new Map(),
      },
    ]

    let result = mergeScanResults(results)

    expect(result.actions).toEqual([action1, action3])
  })
})
