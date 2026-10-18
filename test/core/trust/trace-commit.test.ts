import { describe, expect, it, vi } from 'vitest'

import type { ComparisonStatus } from '../../../types/comparison-status'
import type { GitHubClient } from '../../../types/github-client'
import type { BranchTipAt } from '../../../types/branch-tip-at'
import type { BranchHead } from '../../../types/branch-head'

import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createMockClient } from '../../helpers/create-mock-client'
import { traceCommit } from '../../../core/trust/trace-commit'

const SHA = '34e114876b0b11c390a56381ad16ebd13914f8d5'

const TIP_AT_CUTOFF = 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a'

const RELEASES_V4_TIP = '11d5960a32678a9e3b3ba0b5c1c6e7d9b1dfe4a0'

const RELEASES_V4_TIP_AT_CUTOFF = '5c3ee1b8b3a7f0d2e64c9a1d7f08b2e6c4a9d3f1'

/**
 * Moment `releases/v4` moved to the tip it had at the cut-off, well before
 * `main` did.
 */
const RELEASES_V4_SINCE = new Date('2026-09-01T09:00:00.000Z')

const CUTOFF = new Date('2026-10-02T12:00:00.000Z')

const SINCE = new Date('2026-09-20T09:00:00.000Z')

const COMMIT = { owner: 'actions', repo: 'checkout', tag: 'v4.3.1', sha: SHA }

/**
 * Client of a repository whose default branch is `main`.
 *
 * @param repository - What the repository answers.
 * @param repository.statuses - Status of the commit per comparison base; a base
 *   left out shares no history with it.
 * @param repository.tipAtCutoff - Tip of a branch at the cut-off, per branch; a
 *   branch left out has an undetermined tip.
 * @param repository.protectedBranches - Protected branches with their tips.
 * @returns Mocked client.
 */
function createClient(repository: {
  statuses?: Record<string, ComparisonStatus>
  tipAtCutoff?: Record<string, BranchTipAt>
  protectedBranches?: BranchHead[]
}): GitHubClient {
  let { protectedBranches = [], tipAtCutoff = {}, statuses = {} } = repository
  return createMockClient({
    getBranchTipAt: vi.fn<GitHubClient['getBranchTipAt']>(
      (_owner, _repository, { branch }) =>
        Promise.resolve(tipAtCutoff[branch] ?? null),
    ),
    compareCommits: vi.fn<GitHubClient['compareCommits']>(
      (_owner, _repository, { base }) =>
        Promise.resolve(statuses[base] ?? null),
    ),
    getProtectedBranches: vi
      .fn<GitHubClient['getProtectedBranches']>()
      .mockResolvedValue(protectedBranches),
  })
}

/**
 * Bases the client compared the commit with, in order.
 *
 * @param client - Mocked client.
 * @returns Comparison bases.
 */
function comparedBases(client: GitHubClient): string[] {
  return vi
    .mocked(client.compareCommits)
    .mock.calls.map(([, , { base }]) => base)
}

describe('traceCommit', () => {
  it('finds a commit on the default branch without looking back when no moment is given', async () => {
    let client = createClient({ statuses: { 'refs/heads/main': 'behind' } })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

    expect(trace).toStrictEqual({
      heldAtCutoff: null,
      inHistory: 'yes',
      heldSince: null,
    })
    expect(client.getBranchTipAt).not.toHaveBeenCalled()
  })

  it('settles both questions with one comparison for a commit the default branch held at the moment', async () => {
    let client = createClient({
      tipAtCutoff: {
        main: { sha: TIP_AT_CUTOFF, since: SINCE },
      },
      statuses: { [TIP_AT_CUTOFF]: 'behind' },
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'yes',
      heldSince: SINCE,
      inHistory: 'yes',
    })
    expect(comparedBases(client)).toStrictEqual([TIP_AT_CUTOFF])
    expect(client.getBranchTipAt).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      { branch: 'main', at: CUTOFF },
    )
  })

  it('tells a commit that reached the default branch after the moment, however it is dated', async () => {
    let client = createClient({
      tipAtCutoff: {
        main: { sha: TIP_AT_CUTOFF, since: SINCE },
      },
      statuses: { 'refs/heads/main': 'identical', [TIP_AT_CUTOFF]: 'ahead' },
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'no',
      inHistory: 'yes',
      heldSince: null,
    })
  })

  it.each([
    ['the branch did not exist then', { since: null, sha: null }, 'no'],
    ['its tip then cannot be established', undefined, 'unknown'],
  ] as const)(
    'answers for the moment when %s',
    async (_case, tip, heldAtCutoff) => {
      let client = createClient({
        statuses: { 'refs/heads/main': 'behind' },
        tipAtCutoff: tip ? { main: tip } : {},
      })

      let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

      expect(trace).toMatchObject({ inHistory: 'yes', heldAtCutoff })
    },
  )

  it('finds a commit at the tip of a protected branch and looks back on that branch', async () => {
    let client = createClient({
      tipAtCutoff: {
        'releases/v4': { since: SINCE, sha: SHA },
      },
      protectedBranches: [{ name: 'releases/v4', sha: SHA }],
      statuses: { [SHA]: 'identical' },
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'yes',
      heldSince: SINCE,
      inHistory: 'yes',
    })
    expect(client.getBranchTipAt).toHaveBeenLastCalledWith(
      'actions',
      'checkout',
      { branch: 'releases/v4', at: CUTOFF },
    )
  })

  it('compares the protected branches naming the major version first, once per tip', async () => {
    let client = createClient({
      protectedBranches: [
        { sha: TIP_AT_CUTOFF, name: 'main' },
        { sha: 'a'.repeat(40), name: 'releases/v1' },
        { name: 'releases/v1-old', sha: 'a'.repeat(40) },
        { name: 'releases/v14', sha: 'b'.repeat(40) },
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
      ],
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

    expect(trace.inHistory).toBe('no')
    expect(comparedBases(client)).toStrictEqual([
      'refs/heads/main',
      RELEASES_V4_TIP,
      'a'.repeat(40),
      'b'.repeat(40),
    ])
  })

  it('stops at the first protected branch that holds the commit when no moment is given', async () => {
    let client = createClient({
      protectedBranches: [
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
        { name: 'releases/v4-next', sha: 'a'.repeat(40) },
      ],
      statuses: { [RELEASES_V4_TIP]: 'behind' },
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

    expect(trace).toStrictEqual({
      heldAtCutoff: null,
      inHistory: 'yes',
      heldSince: null,
    })
    expect(comparedBases(client)).toStrictEqual([
      'refs/heads/main',
      RELEASES_V4_TIP,
    ])
    expect(client.getBranchTipAt).not.toHaveBeenCalled()
  })

  it('puts a protected branch at the commit first, which needs no comparison', async () => {
    let client = createClient({
      protectedBranches: [
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
        { name: 'releases/v4-hotfix', sha: SHA },
      ],
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

    expect(trace.inHistory).toBe('yes')
    expect(comparedBases(client)).toStrictEqual(['refs/heads/main'])
  })

  it('dates a commit the default branch got too late by a protected branch that has held it since the moment', async () => {
    let client = createClient({
      tipAtCutoff: {
        'releases/v4': {
          sha: RELEASES_V4_TIP_AT_CUTOFF,
          since: RELEASES_V4_SINCE,
        },
        main: { sha: TIP_AT_CUTOFF, since: SINCE },
      },
      statuses: {
        [RELEASES_V4_TIP_AT_CUTOFF]: 'behind',
        [RELEASES_V4_TIP]: 'behind',
        'refs/heads/main': 'behind',
        [TIP_AT_CUTOFF]: 'ahead',
      },
      protectedBranches: [
        { name: 'releases/v5', sha: 'a'.repeat(40) },
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
      ],
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldSince: RELEASES_V4_SINCE,
      heldAtCutoff: 'yes',
      inHistory: 'yes',
    })
    expect(comparedBases(client)).toStrictEqual([
      TIP_AT_CUTOFF,
      'refs/heads/main',
      RELEASES_V4_TIP,
      RELEASES_V4_TIP_AT_CUTOFF,
    ])
  })

  it('dates a commit by the history of each branch that holds it, even at a tip another branch shares', async () => {
    let client = createClient({
      tipAtCutoff: {
        'releases/v4': {
          sha: RELEASES_V4_TIP_AT_CUTOFF,
          since: RELEASES_V4_SINCE,
        },
        'releases/v4-next': { since: null, sha: null },
      },
      protectedBranches: [
        { name: 'releases/v4-next', sha: RELEASES_V4_TIP },
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
      ],
      statuses: {
        [RELEASES_V4_TIP_AT_CUTOFF]: 'behind',
        [RELEASES_V4_TIP]: 'behind',
      },
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldSince: RELEASES_V4_SINCE,
      heldAtCutoff: 'yes',
      inHistory: 'yes',
    })
    expect(comparedBases(client)).toStrictEqual([
      'refs/heads/main',
      RELEASES_V4_TIP,
      RELEASES_V4_TIP_AT_CUTOFF,
    ])
  })

  it('declares a commit too recent once every branch that holds it got it after the moment', async () => {
    let client = createClient({
      tipAtCutoff: {
        'releases/v4': {
          sha: RELEASES_V4_TIP_AT_CUTOFF,
          since: RELEASES_V4_SINCE,
        },
        main: { sha: TIP_AT_CUTOFF, since: SINCE },
      },
      statuses: {
        [RELEASES_V4_TIP_AT_CUTOFF]: 'ahead',
        [RELEASES_V4_TIP]: 'behind',
        'refs/heads/main': 'behind',
        [TIP_AT_CUTOFF]: 'ahead',
      },
      protectedBranches: [
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
        { sha: 'a'.repeat(40), name: 'releases/v1' },
      ],
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'no',
      inHistory: 'yes',
      heldSince: null,
    })
  })

  it('counts a default branch that no longer holds the commit as not having kept it, whatever its history leaves open', async () => {
    let client = createClient({
      statuses: {
        [RELEASES_V4_TIP_AT_CUTOFF]: 'ahead',
        'refs/heads/main': 'diverged',
        [RELEASES_V4_TIP]: 'behind',
      },
      tipAtCutoff: {
        'releases/v4': {
          sha: RELEASES_V4_TIP_AT_CUTOFF,
          since: RELEASES_V4_SINCE,
        },
      },
      protectedBranches: [{ sha: RELEASES_V4_TIP, name: 'releases/v4' }],
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'no',
      inHistory: 'yes',
      heldSince: null,
    })
  })

  it.each([
    [
      'a protected branch past the comparisons may hold it',
      ['1', '2', '3', '5'].map(major => ({
        name: `releases/v${major}`,
        sha: major.repeat(40),
      })),
      1,
    ],
    [
      'more protected branches hold it than it reads the history of',
      ['a', 'b', 'c', 'd'].map(suffix => ({
        name: `releases/v4-${suffix}`,
        sha: RELEASES_V4_TIP,
      })),
      4,
    ],
    [
      'the protected branches fill a page, which may go on',
      Array.from({ length: 100 }, (_, index) => ({
        name: `releases/v1-${index}`,
        sha: 'a'.repeat(40),
      })),
      1,
    ],
  ])(
    'leaves the date of a commit the default branch got too late open when %s',
    async (_case, protectedBranches, historiesRead) => {
      let client = createClient({
        tipAtCutoff: {
          ...Object.fromEntries(
            protectedBranches.map(branch => [
              branch.name,
              { since: null, sha: null },
            ]),
          ),
          main: { sha: TIP_AT_CUTOFF, since: SINCE },
        },
        statuses: {
          'refs/heads/main': 'behind',
          [RELEASES_V4_TIP]: 'behind',
          [TIP_AT_CUTOFF]: 'ahead',
        },
        protectedBranches,
      })

      let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

      expect(trace).toStrictEqual({
        heldAtCutoff: 'unknown',
        inHistory: 'yes',
        heldSince: null,
      })
      expect(client.getBranchTipAt).toHaveBeenCalledTimes(historiesRead)
    },
  )

  it('leaves the date of a commit the default branch got too late open when the protected branches cannot be read', async () => {
    let client = createClient({
      statuses: { 'refs/heads/main': 'behind', [TIP_AT_CUTOFF]: 'ahead' },
      tipAtCutoff: { main: { sha: TIP_AT_CUTOFF, since: SINCE } },
    })
    vi.mocked(client.getProtectedBranches).mockRejectedValue(
      new Error('GitHub API error: 502'),
    )

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'unknown',
      inHistory: 'yes',
      heldSince: null,
    })
  })

  it('compares the protected branches in their own order for a tag without a version', async () => {
    let client = createClient({
      protectedBranches: [
        { sha: 'a'.repeat(40), name: 'stable' },
        { sha: RELEASES_V4_TIP, name: 'releases/v4' },
      ],
      statuses: { [RELEASES_V4_TIP]: 'behind' },
    })

    let trace = await traceCommit(client, {
      ...COMMIT,
      tag: 'latest',
      cutoff: null,
    })

    expect(trace.inHistory).toBe('yes')
    expect(comparedBases(client)).toStrictEqual([
      'refs/heads/main',
      'a'.repeat(40),
      RELEASES_V4_TIP,
    ])
  })

  it('declares a commit outside the history once every branch has answered', async () => {
    let client = createClient({
      protectedBranches: [
        { sha: 'a'.repeat(40), name: 'releases/v1' },
        { sha: 'b'.repeat(40), name: 'releases/v2' },
      ],
      statuses: { 'refs/heads/main': 'diverged' },
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toStrictEqual({
      heldAtCutoff: 'no',
      inHistory: 'no',
      heldSince: null,
    })
  })

  it.each([
    [
      'more protected branches than it compares',
      createClient({
        protectedBranches: ['1', '2', '3', '5'].map(major => ({
          name: `releases/v${major}`,
          sha: major.repeat(40),
        })),
      }),
    ],
    [
      'a failed comparison with a protected branch',
      createMockClient({
        compareCommits: vi
          .fn<GitHubClient['compareCommits']>()
          .mockImplementation((_owner, _repository, { base }) =>
            base === 'refs/heads/main' ?
              Promise.resolve('diverged')
            : Promise.reject(new Error('GitHub API error: 502')),
          ),
        getProtectedBranches: vi
          .fn<GitHubClient['getProtectedBranches']>()
          .mockResolvedValue([{ sha: RELEASES_V4_TIP, name: 'releases/v4' }]),
      }),
    ],
    [
      'a failed comparison with the default branch',
      createMockClient({
        compareCommits: vi
          .fn<GitHubClient['compareCommits']>()
          .mockRejectedValue(new Error('GitHub API error: 502')),
      }),
    ],
  ])('leaves provenance open after %s', async (_case, client) => {
    let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

    expect(trace.inHistory).toBe('unknown')
  })

  it('leaves provenance open after a full page of protected branches, which may go on', async () => {
    let client = createClient({
      protectedBranches: Array.from({ length: 100 }, (_, index) => ({
        name: `releases/v4-${index}`,
        sha: RELEASES_V4_TIP,
      })),
    })

    let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

    expect(trace.inHistory).toBe('unknown')
  })

  it.each([
    [
      'the default branch',
      {
        getDefaultBranch: vi
          .fn<GitHubClient['getDefaultBranch']>()
          .mockRejectedValue(new Error('GitHub API error: 502')),
      },
    ],
    [
      'the protected branches',
      {
        getProtectedBranches: vi
          .fn<GitHubClient['getProtectedBranches']>()
          .mockRejectedValue(new Error('GitHub API error: 502')),
      },
    ],
  ])(
    'leaves provenance open when %s cannot be read',
    async (_case, overrides) => {
      let client = createMockClient(overrides)

      let trace = await traceCommit(client, { ...COMMIT, cutoff: null })

      expect(trace).toStrictEqual({
        inHistory: 'unknown',
        heldAtCutoff: null,
        heldSince: null,
      })
    },
  )

  it('leaves the moment open when the history of the branch cannot be read', async () => {
    let client = createClient({ statuses: { 'refs/heads/main': 'behind' } })
    vi.mocked(client.getBranchTipAt).mockRejectedValue(
      new Error('GitHub API error: 502'),
    )

    let trace = await traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    expect(trace).toMatchObject({ heldAtCutoff: 'unknown', inHistory: 'yes' })
  })

  it.each([
    'getDefaultBranch',
    'getBranchTipAt',
    'compareCommits',
    'getProtectedBranches',
  ] as const)('lets a rate-limited %s through', async method => {
    let error = new GitHubRateLimitError(new Date('2026-10-03T14:37:21.000Z'))
    let client = createClient({
      tipAtCutoff: {
        main: { sha: TIP_AT_CUTOFF, since: SINCE },
      },
      statuses: { 'refs/heads/main': 'ahead', [TIP_AT_CUTOFF]: 'ahead' },
    })
    vi.mocked(client[method]).mockRejectedValue(error)

    let trace = traceCommit(client, { ...COMMIT, cutoff: CUTOFF })

    await expect(trace).rejects.toBe(error)
  })
})
