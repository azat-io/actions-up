import { describe, expect, it } from 'vitest'

import type { GitHubAction } from '../../types/github-action'
import type { ScanResult } from '../../types/scan-result'

import { mergeScanResults } from '../../cli/merge-scan-results'

/**
 * Create an action reference as the scanner reports it.
 *
 * @param overrides - Fields that differ from `actions/checkout@v4` on line 12
 *   of the CI workflow.
 * @returns Fresh action reference.
 */
function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    file: '/repo/.github/workflows/ci.yml',
    name: 'actions/checkout',
    type: 'external',
    version: 'v4',
    job: 'build',
    line: 12,
    ...overrides,
  }
}

/**
 * Create the result of scanning one directory.
 *
 * @param overrides - Parts of the result that are not empty.
 * @returns Fresh scan result.
 */
function makeScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    compositeActions: new Map(),
    workflows: new Map(),
    actions: [],
    ...overrides,
  }
}

describe('mergeScanResults', () => {
  it('returns an empty result for no scan results', () => {
    let result = mergeScanResults([])

    expect(result).toStrictEqual({
      compositeActions: new Map(),
      workflows: new Map(),
      actions: [],
    })
  })

  it('keeps the workflows of every scan result with their actions in order', () => {
    let ciActions = [makeAction()]
    let releaseActions = [
      makeAction({
        file: '/repo/.github/workflows/release.yml',
        name: 'actions/setup-node',
        line: 20,
      }),
    ]
    let lintActions = [
      makeAction({
        file: '/repo/tools/.github/workflows/lint.yml',
        name: 'actions/cache',
        line: 8,
      }),
    ]
    let results = [
      makeScanResult({
        workflows: new Map([
          ['.github/workflows/release.yml', releaseActions],
          ['.github/workflows/ci.yml', ciActions],
        ]),
      }),
      makeScanResult({
        workflows: new Map([['.github/workflows/lint.yml', lintActions]]),
      }),
    ]

    let result = mergeScanResults(results)

    expect(result.workflows.values().toArray()).toStrictEqual([
      releaseActions,
      ciActions,
      lintActions,
    ])
  })

  it('keeps the composite actions of every scan result in order', () => {
    let results = [
      makeScanResult({
        compositeActions: new Map([
          ['build', '.github/actions/build'],
          ['lint', '.github/actions/lint'],
        ]),
      }),
      makeScanResult({
        compositeActions: new Map([['action.yml', 'action.yml']]),
      }),
    ]

    let result = mergeScanResults(results)

    expect(result.compositeActions.values().toArray()).toStrictEqual([
      '.github/actions/build',
      '.github/actions/lint',
      'action.yml',
    ])
  })

  it('counts workflows sharing a path in different scan results separately', () => {
    let results = [
      makeScanResult({
        workflows: new Map([
          [
            '.github/workflows/ci.yml',
            [makeAction({ file: '/repo/app/.github/workflows/ci.yml' })],
          ],
        ]),
      }),
      makeScanResult({
        workflows: new Map([
          [
            '.github/workflows/ci.yml',
            [makeAction({ file: '/repo/docs/.github/workflows/ci.yml' })],
          ],
        ]),
      }),
    ]

    let result = mergeScanResults(results)

    expect(result.workflows.size).toBe(2)
  })

  it('counts composite actions sharing a path in different scan results separately', () => {
    let results = [
      makeScanResult({
        compositeActions: new Map([['build', '.github/actions/build']]),
      }),
      makeScanResult({
        compositeActions: new Map([['build', '.github/actions/build']]),
      }),
    ]

    let result = mergeScanResults(results)

    expect(result.compositeActions.size).toBe(2)
  })

  it('keeps the actions of every scan result in order', () => {
    let checkout = makeAction()
    let setupNode = makeAction({
      file: '/repo/.github/workflows/release.yml',
      name: 'actions/setup-node',
      line: 20,
    })
    let results = [
      makeScanResult({ actions: [checkout] }),
      makeScanResult({ actions: [setupNode] }),
    ]

    let result = mergeScanResults(results)

    expect(result.actions).toStrictEqual([checkout, setupNode])
  })

  it.each([
    {
      other: makeAction({ file: '/repo/.github/workflows/release.yml' }),
      component: 'file',
    },
    {
      other: makeAction({ line: 30 }),
      component: 'line',
    },
    {
      other: makeAction({ name: 'actions/setup-node' }),
      component: 'name',
    },
    {
      other: makeAction({ version: 'v5' }),
      component: 'version',
    },
  ])(
    'keeps two actions from different scan results that differ only in $component',
    ({ other }) => {
      let action = makeAction()

      let result = mergeScanResults([
        makeScanResult({ actions: [action] }),
        makeScanResult({ actions: [other] }),
      ])

      expect(result.actions).toStrictEqual([action, other])
    },
  )

  it('keeps one of two identical actions found by different scan results', () => {
    let action = makeAction()

    let result = mergeScanResults([
      makeScanResult({ actions: [action] }),
      makeScanResult({ actions: [makeAction()] }),
    ])

    expect(result.actions).toStrictEqual([action])
  })
})
