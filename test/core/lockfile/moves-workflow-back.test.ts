import { describe, expect, it } from 'vitest'

import type { GitHubAction } from '../../../types/github-action'

import { movesWorkflowBack } from '../../../core/lockfile/moves-workflow-back'

/**
 * Commit `v4.2.2` of `actions/checkout` points at, the latest one, which the
 * plan checked.
 */
const CHECKED_SHA = 'b4ffde65f46336ab88eb53be808477a3936bae11'

/**
 * Older commit an earlier relock recorded for `actions/checkout@v4`.
 */
const KEPT_SHA = 'f43a0e5ff2bd294095638e18286ca9a3d1956744'

/**
 * Commit an earlier relock recorded for `actions/checkout@v3`.
 */
const OLDER_SHA = '692973e3d937129bcbf40652eb9f2f61becf3332'

/**
 * Lockfile that pins `v4.2.2` of checkout at the checked commit, as for the CI
 * workflow, and `v4` and `v3` at older ones, as for other workflows.
 */
const LOCKFILE = {
  commits: new Map([
    ['actions/checkout@v4.2.2', CHECKED_SHA],
    ['actions/checkout@v3', OLDER_SHA],
    ['actions/checkout@v4', KEPT_SHA],
  ]),
}

/**
 * Fields of an update to replace.
 */
interface UpdateOverrides {
  /**
   * Fields of the action to replace.
   */
  action?: Partial<GitHubAction>

  /**
   * Commit the plan checked.
   */
  latestSha?: string | null

  /**
   * Reference the update writes.
   */
  targetRef?: string | null
}

/**
 * Create a locked update of checkout in the CI workflow, from `v4.2.2` to `v4`,
 * checked at the latest commit.
 *
 * @param overrides - Fields to replace.
 * @returns The update, as far as the check reads it.
 */
function makeUpdate(
  overrides: UpdateOverrides = {},
): Parameters<typeof movesWorkflowBack>[0] {
  let { action, ...update } = overrides
  return {
    action: {
      file: '/repo/.github/workflows/ci.yml',
      name: 'actions/checkout',
      version: 'v4.2.2',
      type: 'external',
      locked: true,
      ...action,
    },
    latestSha: CHECKED_SHA,
    targetRef: 'v4',
    ...update,
  }
}

describe('movesWorkflowBack', () => {
  it('takes a tag of the latest version written as a floating tag the lockfile pins at an older commit for one that moves the workflow back', () => {
    expect(movesWorkflowBack(makeUpdate(), LOCKFILE)).toBe(true)
  })

  it('takes a SHA of the latest commit written as a tag the lockfile pins at an older commit for one that moves the workflow back', () => {
    expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: CHECKED_SHA } }),
        LOCKFILE,
      ),
    ).toBe(true)
  })

  it('matches the repository and the commits whatever their case, without the path of an action in a subdirectory', () => {
    let lockfile = {
      commits: new Map([
        ['github/codeql-action@v3.28.0', CHECKED_SHA],
        ['github/codeql-action@v3', KEPT_SHA],
      ]),
    }

    expect(
      movesWorkflowBack(
        makeUpdate({
          action: { name: 'GitHub/CodeQL-Action/init', version: 'v3.28.0' },
          latestSha: CHECKED_SHA.toUpperCase(),
          targetRef: 'v3',
        }),
        lockfile,
      ),
    ).toBe(true)
    expect(
      movesWorkflowBack(
        makeUpdate({
          action: {
            version: CHECKED_SHA.toUpperCase(),
            name: 'GitHub/CodeQL-Action/init',
          },
          targetRef: 'v3',
        }),
        lockfile,
      ),
    ).toBe(true)
  })

  it.each<[string, UpdateOverrides]>([
    [
      'an update from a reference the lockfile pins at an older commit, which moves the workflow forward all the same,',
      { action: { version: 'v3' } },
    ],
    [
      'an update from a SHA of an older commit, which moves the workflow forward all the same,',
      { action: { version: OLDER_SHA } },
    ],
    [
      'an update from a reference the lockfile does not record, whose commit is unknown,',
      { action: { version: 'v4.2.1' } },
    ],
    [
      'an update to a reference the lockfile does not record',
      { targetRef: 'v4.2' },
    ],
    [
      'an update to a reference the lockfile pins at the checked commit',
      { action: { version: CHECKED_SHA }, targetRef: 'v4.2.2' },
    ],
    [
      'an update of an action that names no repository',
      { action: { name: 'checkout' } },
    ],
    ['an update that writes no reference', { targetRef: null }],
    ['an update from no reference', { action: { version: null } }],
    ['an update whose checked commit is unknown', { latestSha: null }],
  ])(
    'does not take %s for one that moves the workflow back',
    (_case, overrides) => {
      expect(movesWorkflowBack(makeUpdate(overrides), LOCKFILE)).toBe(false)
    },
  )

  it('does not take an update for one that moves the workflow back when the lockfile cannot be read', () => {
    expect(movesWorkflowBack(makeUpdate(), { commits: null })).toBe(false)
  })
})
