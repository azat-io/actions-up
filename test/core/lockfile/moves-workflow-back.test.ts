import type { Mock } from 'vitest'

import { describe, expect, it, vi } from 'vitest'

import type { GitHubAction } from '../../../types/github-action'
import type { GitHubClient } from '../../../types/github-client'

import { GitHubRateLimitError } from '../../../core/api/github-rate-limit-error'
import { movesWorkflowBack } from '../../../core/lockfile/moves-workflow-back'

/**
 * Commit an earlier relock recorded for `actions/checkout@v3`.
 */
const OLDER_SHA = '692973e3d937129bcbf40652eb9f2f61becf3332'

/**
 * Commit an earlier relock recorded for `actions/checkout@v4`, as for the
 * release workflow.
 */
const KEPT_SHA = 'f43a0e5ff2bd294095638e18286ca9a3d1956744'

/**
 * Commit an earlier relock recorded for `actions/checkout@v4.2.1`, as for the
 * CI workflow.
 */
const RUNNING_SHA = 'eef61447b9ff4aafe5dcd4e0bbf5d482be7e7871'

/**
 * Commit `v4.2.2` of `actions/checkout` points at, the latest one, which the
 * plan checked.
 */
const CHECKED_SHA = 'b4ffde65f46336ab88eb53be808477a3936bae11'

/**
 * Commits of `actions/checkout` in the order they were made on its default
 * branch.
 */
const HISTORY = [OLDER_SHA, KEPT_SHA, RUNNING_SHA, CHECKED_SHA]

/**
 * Lockfile that pins `v4.2.2` of checkout at the checked commit, and `v4.2.1`,
 * `v4` and `v3` at older ones, each as for some workflow.
 */
const LOCKFILE = {
  commits: new Map([
    ['actions/checkout@v4.2.2', CHECKED_SHA],
    ['actions/checkout@v4.2.1', RUNNING_SHA],
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
 * Create a GitHub client that compares commits the way GitHub does for the
 * history in `HISTORY`: a commit compared with an earlier one is `ahead` of it,
 * one compared with a later one is `behind` it, and a commit outside the
 * history shares none with the others.
 *
 * @returns The client, as far as the check uses it.
 */
function createHistoryClient(): {
  compareCommits: Mock<GitHubClient['compareCommits']>
} {
  return {
    compareCommits: vi.fn<GitHubClient['compareCommits']>(
      (_owner, _repository, { base, head }) => {
        let from = HISTORY.indexOf(base)
        let to = HISTORY.indexOf(head)
        if (from === -1 || to === -1) {
          return Promise.resolve(null)
        }
        if (from === to) {
          return Promise.resolve('identical')
        }
        return Promise.resolve(from < to ? 'ahead' : 'behind')
      },
    ),
  }
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
  it('takes an upgrade to a floating tag the lockfile pins at a commit older than the one the workflow runs for one that moves the workflow back, though that is not the checked commit', async () => {
    let client = createHistoryClient()

    await expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: 'v4.2.1' } }),
        LOCKFILE,
        client,
      ),
    ).resolves.toBe(true)
    expect(client.compareCommits).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      { base: RUNNING_SHA, head: KEPT_SHA },
    )
  })

  it('compares the commit the workflow runs with the kept one when the checked commit is unknown', async () => {
    let client = createHistoryClient()

    await expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: 'v4.2.1' }, latestSha: null }),
        LOCKFILE,
        client,
      ),
    ).resolves.toBe(true)
    await expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: 'v3' }, latestSha: null }),
        LOCKFILE,
        client,
      ),
    ).resolves.toBe(false)
    expect(client.compareCommits.mock.calls).toStrictEqual([
      ['actions', 'checkout', { base: RUNNING_SHA, head: KEPT_SHA }],
      ['actions', 'checkout', { base: OLDER_SHA, head: KEPT_SHA }],
    ])
  })

  it.each<[string, UpdateOverrides]>([
    [
      'a tag of the latest version written as a floating tag',
      { action: { version: 'v4.2.2' } },
    ],
    [
      'a SHA of the latest commit written as a tag',
      { action: { version: CHECKED_SHA } },
    ],
  ])(
    'takes %s the lockfile pins at another commit for one that moves the workflow back, without comparing them, since the workflow runs the checked commit already',
    async (_case, overrides) => {
      let client = createHistoryClient()

      await expect(
        movesWorkflowBack(makeUpdate(overrides), LOCKFILE, client),
      ).resolves.toBe(true)
      expect(client.compareCommits).not.toHaveBeenCalled()
    },
  )

  it('matches the repository and the commits whatever their case, and compares them in the repository, without the path of an action in a subdirectory', async () => {
    let client = createHistoryClient()
    let lockfile = {
      commits: new Map([
        ['github/codeql-action@v3.28.0', CHECKED_SHA],
        ['github/codeql-action@v3.27.0', RUNNING_SHA],
        ['github/codeql-action@v3', KEPT_SHA],
      ]),
    }

    await expect(
      movesWorkflowBack(
        makeUpdate({
          action: { name: 'GitHub/CodeQL-Action/init', version: 'v3.28.0' },
          latestSha: CHECKED_SHA.toUpperCase(),
          targetRef: 'v3',
        }),
        lockfile,
        client,
      ),
    ).resolves.toBe(true)
    await expect(
      movesWorkflowBack(
        makeUpdate({
          action: {
            version: CHECKED_SHA.toUpperCase(),
            name: 'GitHub/CodeQL-Action/init',
          },
          targetRef: 'v3',
        }),
        lockfile,
        client,
      ),
    ).resolves.toBe(true)
    expect(client.compareCommits).not.toHaveBeenCalled()

    await expect(
      movesWorkflowBack(
        makeUpdate({
          action: { name: 'GitHub/CodeQL-Action/init', version: 'v3.27.0' },
          targetRef: 'v3',
        }),
        lockfile,
        client,
      ),
    ).resolves.toBe(true)
    expect(client.compareCommits).toHaveBeenCalledExactlyOnceWith(
      'GitHub',
      'CodeQL-Action',
      { base: RUNNING_SHA, head: KEPT_SHA },
    )
  })

  it.each<[string, UpdateOverrides, string]>([
    [
      'an upgrade from a reference the lockfile pins at a commit the kept one descends from',
      { action: { version: 'v3' } },
      OLDER_SHA,
    ],
    [
      'an upgrade from a SHA of a commit the kept one descends from',
      { action: { version: OLDER_SHA.toUpperCase() } },
      OLDER_SHA,
    ],
  ])(
    'does not take %s for one that moves the workflow back',
    async (_case, overrides, running) => {
      let client = createHistoryClient()

      await expect(
        movesWorkflowBack(makeUpdate(overrides), LOCKFILE, client),
      ).resolves.toBe(false)
      expect(client.compareCommits).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        { head: KEPT_SHA, base: running },
      )
    },
  )

  it.each<[string, UpdateOverrides]>([
    [
      'an update from a SHA of the commit the lockfile keeps, which leaves the workflow on it,',
      { action: { version: KEPT_SHA } },
    ],
    [
      'an update to a reference the lockfile does not record',
      { targetRef: 'v4.2' },
    ],
    [
      'an update to a reference the lockfile pins at the checked commit',
      { action: { version: 'v4.2.1' }, targetRef: 'v4.2.2' },
    ],
    [
      'an update of an action that names no repository',
      { action: { name: 'checkout' } },
    ],
    ['an update that writes no reference', { targetRef: null }],
  ])(
    'does not take %s for one that moves the workflow back, without comparing commits',
    async (_case, overrides) => {
      let client = createHistoryClient()

      await expect(
        movesWorkflowBack(makeUpdate(overrides), LOCKFILE, client),
      ).resolves.toBe(false)
      expect(client.compareCommits).not.toHaveBeenCalled()
    },
  )

  it('does not take an update from the reference the lockfile pins at the commit it keeps for one that moves the workflow back', async () => {
    let client = createHistoryClient()
    let lockfile = {
      commits: new Map([
        ['actions/checkout@v4.1.7', KEPT_SHA],
        ['actions/checkout@v4', KEPT_SHA],
      ]),
    }

    await expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: 'v4.1.7' } }),
        lockfile,
        client,
      ),
    ).resolves.toBe(false)
    expect(client.compareCommits).not.toHaveBeenCalled()
  })

  it.each<[string, UpdateOverrides]>([
    [
      'an update from a reference the lockfile does not record, whose commit is unknown,',
      { action: { version: 'v4.2.0' } },
    ],
    ['an update from no reference', { action: { version: null } }],
  ])(
    'takes %s for one that moves the workflow back, without comparing commits',
    async (_case, overrides) => {
      let client = createHistoryClient()

      await expect(
        movesWorkflowBack(makeUpdate(overrides), LOCKFILE, client),
      ).resolves.toBe(true)
      expect(client.compareCommits).not.toHaveBeenCalled()
    },
  )

  it('takes an update from a commit that shares no history with the kept one for one that moves the workflow back', async () => {
    let client = createHistoryClient()
    let unrelated = '9d5bc5a87f6a0e9f2aa4e5ec0bbd4d1e9a6b2c11'

    await expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: unrelated } }),
        LOCKFILE,
        client,
      ),
    ).resolves.toBe(true)
    expect(client.compareCommits).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      { base: unrelated, head: KEPT_SHA },
    )
  })

  it.each<[string, Mock<GitHubClient['compareCommits']>]>([
    [
      'the kept commit and the one the workflow runs have diverged',
      vi.fn<GitHubClient['compareCommits']>().mockResolvedValue('diverged'),
    ],
    [
      'the comparison of the two failed',
      vi
        .fn<GitHubClient['compareCommits']>()
        .mockRejectedValue(new Error('Server Error')),
    ],
  ])(
    'takes an update for one that moves the workflow back when %s',
    async (_case, compareCommits) => {
      await expect(
        movesWorkflowBack(makeUpdate({ action: { version: 'v3' } }), LOCKFILE, {
          compareCommits,
        }),
      ).resolves.toBe(true)
      expect(compareCommits).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        { base: OLDER_SHA, head: KEPT_SHA },
      )
    },
  )

  it('does not take an update for one that moves the workflow back when GitHub finds the commit the workflow runs identical to the kept one, as for a short SHA of it', async () => {
    let compareCommits = vi
      .fn<GitHubClient['compareCommits']>()
      .mockResolvedValue('identical')

    await expect(
      movesWorkflowBack(
        makeUpdate({ action: { version: KEPT_SHA.slice(0, 7) } }),
        LOCKFILE,
        { compareCommits },
      ),
    ).resolves.toBe(false)
    expect(compareCommits).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      { base: KEPT_SHA.slice(0, 7), head: KEPT_SHA },
    )
  })

  it('lets a rate limit of the comparison through', async () => {
    let limit = new GitHubRateLimitError(new Date('2026-10-03T14:37:21.000Z'))

    await expect(
      movesWorkflowBack(makeUpdate({ action: { version: 'v3' } }), LOCKFILE, {
        compareCommits: vi
          .fn<GitHubClient['compareCommits']>()
          .mockRejectedValue(limit),
      }),
    ).rejects.toBe(limit)
  })

  it('does not take an update for one that moves the workflow back when the lockfile cannot be read', async () => {
    let client = createHistoryClient()

    await expect(
      movesWorkflowBack(makeUpdate(), { commits: null }, client),
    ).resolves.toBe(false)
    expect(client.compareCommits).not.toHaveBeenCalled()
  })
})
