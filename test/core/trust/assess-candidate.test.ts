import { describe, expect, it, vi } from 'vitest'

import type { ComparisonStatus } from '../../../types/comparison-status'
import type { GitHubClient } from '../../../types/github-client'
import type { BranchTipAt } from '../../../types/branch-tip-at'
import type { ReleaseInfo } from '../../../types/release-info'
import type { Cooldown } from '../../../types/cooldown'

import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { assessCandidate } from '../../../core/trust/assess-candidate'
import { createMockClient } from '../../helpers/create-mock-client'

const DAY_MS = 24 * 60 * 60 * 1000

const NOW = new Date('2026-10-03T12:00:00.000Z')

const COOL_DOWN: Cooldown = { now: NOW.getTime(), minAgeMs: DAY_MS }

const CUTOFF = new Date('2026-10-02T12:00:00.000Z')

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'

const PINNED_SHA = 'e'.repeat(40)

const TIP_AT_CUTOFF = 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a'

const TWO_YEARS_AGO = new Date('2024-10-03T12:00:00.000Z')

const ON_BRANCH_SINCE = new Date('2026-09-20T09:00:00.000Z')

const AN_HOUR_AGO = new Date('2026-10-03T11:00:00.000Z')

const CANDIDATE = { owner: 'actions', repo: 'checkout', tag: 'v4.2.2' }

const IMMUTABLE_RELEASE: ReleaseInfo = {
  url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
  publishedAt: TWO_YEARS_AGO,
  isPrerelease: false,
  description: null,
  version: 'v4.2.2',
  immutable: true,
  name: 'v4.2.2',
}

/**
 * Client of a repository whose tag `v4.2.2` points at the commit, which the
 * default branch `main` holds and already held at the start of the cool-down.
 *
 * @param repository - What differs from that repository.
 * @param repository.tipAtCutoff - Tip of `main` at the start of the cool-down,
 *   null when it cannot be established.
 * @param repository.statuses - Status of the commit per comparison base; a base
 *   left out shares no history with it.
 * @param repository.overrides - Methods to replace.
 * @returns Mocked client.
 */
function createClient(
  repository: {
    statuses?: Record<string, ComparisonStatus>
    overrides?: Partial<GitHubClient>
    tipAtCutoff?: BranchTipAt | null
  } = {},
): GitHubClient {
  let {
    tipAtCutoff = {
      since: ON_BRANCH_SINCE,
      sha: TIP_AT_CUTOFF,
    },
    statuses = { 'refs/heads/main': 'behind', [TIP_AT_CUTOFF]: 'behind' },
    overrides = {},
  } = repository
  return createMockClient({
    compareCommits: vi.fn<GitHubClient['compareCommits']>(
      (_owner, _repository, { base }) =>
        Promise.resolve(statuses[base] ?? null),
    ),
    getBranchTipAt: vi
      .fn<GitHubClient['getBranchTipAt']>()
      .mockResolvedValue(tipAtCutoff),
    getTagSha: vi.fn<GitHubClient['getTagSha']>().mockResolvedValue(SHA),
    ...overrides,
  })
}

/**
 * Release facts of a tag.
 *
 * @param publishedAt - Publication date, null when it cannot be read.
 * @param immutable - Whether the release is immutable.
 * @returns Release fields the assessment reads.
 */
function releasedAt(
  publishedAt: Date | null,
  immutable = false,
): Pick<ReleaseInfo, 'publishedAt' | 'immutable'> {
  return { publishedAt, immutable }
}

describe('assessCandidate', () => {
  describe('commit', () => {
    it('reads the commit from the tag reference when no listing named it', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        cooldown: null,
      })

      expect(assessment.sha).toBe(SHA)
      expect(client.getTagSha).toHaveBeenCalledWith(
        'actions',
        'checkout',
        'v4.2.2',
      )
    })

    it('keeps the commit a listing already read from the tag reference', async () => {
      let client = createClient()

      await assessCandidate(client, { ...CANDIDATE, cooldown: null, sha: SHA })

      expect(client.getTagSha).not.toHaveBeenCalled()
    })

    it.each([
      ['points at no commit', vi.fn().mockResolvedValue(null), 'no-commit'],
      [
        'cannot be read',
        vi.fn().mockRejectedValue(new Error('fetch failed')),
        'sha-unresolved',
      ],
    ])(
      'holds a tag that %s, without falling back to another commit',
      async (_case, getTagSha, reason) => {
        let client = createClient({ overrides: { getTagSha } })

        let assessment = await assessCandidate(client, {
          ...CANDIDATE,
          release: releasedAt(TWO_YEARS_AGO),
          cooldown: COOL_DOWN,
        })

        expect(assessment).toMatchObject({ sha: null, reason })
        expect(client.compareCommits).not.toHaveBeenCalled()
      },
    )

    it('lets a rate-limited tag lookup through', async () => {
      let error = new GitHubRateLimitError(NOW)
      let client = createClient({
        overrides: {
          getTagSha: vi
            .fn<GitHubClient['getTagSha']>()
            .mockRejectedValue(error),
        },
      })

      let assessment = assessCandidate(client, { ...CANDIDATE, cooldown: null })

      await expect(assessment).rejects.toBe(error)
    })
  })

  describe('with the cool-down on', () => {
    it('admits an old release whose commit the default branch held at the start of the cool-down', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(TWO_YEARS_AGO),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment).toStrictEqual({
        effectiveDate: ON_BRANCH_SINCE,
        publishedAt: TWO_YEARS_AGO,
        immutableRelease: false,
        ageSource: 'branch',
        reason: null,
        sha: SHA,
      })
      expect(client.getBranchTipAt).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        { branch: 'main', at: CUTOFF },
      )
    })

    it('holds back a backdated commit pushed to the default branch today under the tag of an old release', async () => {
      let client = createClient({
        statuses: { 'refs/heads/main': 'identical', [TIP_AT_CUTOFF]: 'ahead' },
      })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(TWO_YEARS_AGO),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment).toMatchObject({
        effectiveDate: null,
        reason: 'cool-down',
        ageSource: null,
      })
    })

    it('dates a commit by the start of the cool-down when the tip that held it then predates the recorded history', async () => {
      let client = createClient({
        tipAtCutoff: { sha: TIP_AT_CUTOFF, since: null },
      })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(TWO_YEARS_AGO),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment).toMatchObject({
        effectiveDate: CUTOFF,
        ageSource: 'branch',
        reason: null,
      })
    })

    it('holds the candidate back as undated when the tip at the start of the cool-down cannot be established', async () => {
      let client = createClient({ tipAtCutoff: null })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(TWO_YEARS_AGO),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment.reason).toBe('age-unknown')
    })

    it('measures a tag without a release by the history of its branch alone', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        cooldown: COOL_DOWN,
        release: null,
        sha: SHA,
      })

      expect(assessment).toMatchObject({
        effectiveDate: ON_BRANCH_SINCE,
        immutableRelease: false,
        ageSource: 'branch',
        publishedAt: null,
        reason: null,
      })
    })

    it('holds back a release inside the cool-down without checking its commit', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(AN_HOUR_AGO),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment).toMatchObject({
        effectiveDate: AN_HOUR_AGO,
        ageSource: 'release',
        reason: 'cool-down',
      })
      expect(client.compareCommits).not.toHaveBeenCalled()
    })

    it('holds back a release whose publication date cannot be read', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(null),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment.reason).toBe('age-unknown')
    })

    it('admits an immutable release older than the cool-down by its publication date, checking only provenance', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(TWO_YEARS_AGO, true),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment).toMatchObject({
        effectiveDate: TWO_YEARS_AGO,
        immutableRelease: true,
        ageSource: 'release',
        reason: null,
      })
      expect(client.getBranchTipAt).not.toHaveBeenCalled()
    })

    it('looks the release up when the caller does not hold it', async () => {
      let client = createClient({
        overrides: {
          getReleaseByTag: vi
            .fn<GitHubClient['getReleaseByTag']>()
            .mockResolvedValue(IMMUTABLE_RELEASE),
        },
      })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment).toMatchObject({
        publishedAt: TWO_YEARS_AGO,
        immutableRelease: true,
        reason: null,
      })
      expect(client.getReleaseByTag).toHaveBeenCalledWith(
        'actions',
        'checkout',
        'v4.2.2',
      )
    })

    it('holds the candidate back as undated when the release lookup fails', async () => {
      let client = createClient({
        overrides: {
          getReleaseByTag: vi
            .fn<GitHubClient['getReleaseByTag']>()
            .mockRejectedValue(new Error('GitHub API error: 502 Bad Gateway')),
        },
      })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment.reason).toBe('age-unknown')
    })

    it('lets a rate-limited release lookup through', async () => {
      let error = new GitHubRateLimitError(NOW)
      let client = createClient({
        overrides: {
          getReleaseByTag: vi
            .fn<GitHubClient['getReleaseByTag']>()
            .mockRejectedValue(error),
        },
      })

      let assessment = assessCandidate(client, {
        ...CANDIDATE,
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      await expect(assessment).rejects.toBe(error)
    })
  })

  describe('pinned commit', () => {
    it.each([
      ['with the cool-down on', COOL_DOWN],
      ['with the cool-down off', null],
    ])(
      'holds a tag that now points at another commit than the pin as moved %s, without checking history',
      async (_case, cooldown) => {
        let client = createClient()

        let assessment = await assessCandidate(client, {
          ...CANDIDATE,
          release: releasedAt(TWO_YEARS_AGO),
          pinnedSha: PINNED_SHA,
          cooldown,
          sha: SHA,
        })

        expect(assessment.reason).toBe('tag-moved')
        expect(client.compareCommits).not.toHaveBeenCalled()
      },
    )

    it.each([
      ['the tag still points at the pin', releasedAt(TWO_YEARS_AGO), SHA],
      [
        'the release is immutable, so the pin was written by hand',
        releasedAt(TWO_YEARS_AGO, true),
        PINNED_SHA,
      ],
    ])(
      'does not hold the tag as moved when %s',
      async (_case, release, pinnedSha) => {
        let client = createClient()

        let assessment = await assessCandidate(client, {
          ...CANDIDATE,
          cooldown: COOL_DOWN,
          pinnedSha,
          sha: SHA,
          release,
        })

        expect(assessment.reason).toBeNull()
      },
    )

    it('holds a tag that moved away from the pin as moved even when its release is recent, as a recreated release would be', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(AN_HOUR_AGO),
        pinnedSha: PINNED_SHA,
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment.reason).toBe('tag-moved')
    })

    it.each([
      ['with the cool-down on', COOL_DOWN],
      ['with the cool-down off', null],
    ])(
      'decides on an immutable release only once its release was looked up %s',
      async (_case, cooldown) => {
        let client = createClient({
          overrides: {
            getReleaseByTag: vi
              .fn<GitHubClient['getReleaseByTag']>()
              .mockResolvedValue(IMMUTABLE_RELEASE),
          },
        })

        let assessment = await assessCandidate(client, {
          ...CANDIDATE,
          pinnedSha: PINNED_SHA,
          cooldown,
          sha: SHA,
        })

        expect(assessment.reason).toBeNull()
        expect(client.getReleaseByTag).toHaveBeenCalledExactlyOnceWith(
          'actions',
          'checkout',
          'v4.2.2',
        )
      },
    )

    it('leaves a tag that points at another commit than the pin unresolved when its release cannot be read with the cool-down off', async () => {
      let client = createClient({
        overrides: {
          getReleaseByTag: vi
            .fn<GitHubClient['getReleaseByTag']>()
            .mockRejectedValue(new Error('GitHub API error: 502 Bad Gateway')),
        },
      })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        pinnedSha: PINNED_SHA,
        cooldown: null,
        sha: SHA,
      })

      expect(assessment.reason).toBe('release-unresolved')
      expect(client.compareCommits).not.toHaveBeenCalled()
    })
  })

  describe('with the cool-down off', () => {
    it('checks provenance alone and reports the release it knows of', async () => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(AN_HOUR_AGO, true),
        cooldown: null,
        sha: SHA,
      })

      expect(assessment).toStrictEqual({
        publishedAt: AN_HOUR_AGO,
        immutableRelease: true,
        effectiveDate: null,
        ageSource: null,
        reason: null,
        sha: SHA,
      })
      expect(client.getBranchTipAt).not.toHaveBeenCalled()
      expect(client.getReleaseByTag).not.toHaveBeenCalled()
    })

    it.each([
      ['without a pin', null],
      ['for a pin the tag still points at', SHA],
    ])('does not look the release up %s', async (_case, pinnedSha) => {
      let client = createClient()

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        cooldown: null,
        pinnedSha,
        sha: SHA,
      })

      expect(assessment.reason).toBeNull()
      expect(client.getReleaseByTag).not.toHaveBeenCalled()
    })
  })

  describe('provenance', () => {
    it.each([
      ['with the cool-down on', COOL_DOWN],
      ['with the cool-down off', null],
    ])(
      'holds back a commit no trusted branch holds %s',
      async (_case, cooldown) => {
        let client = createClient({ statuses: {} })

        let assessment = await assessCandidate(client, {
          ...CANDIDATE,
          release: releasedAt(TWO_YEARS_AGO),
          cooldown,
          sha: SHA,
        })

        expect(assessment.reason).toBe('unreachable-commit')
      },
    )

    it('reports a commit whose provenance cannot be established as unverified', async () => {
      let client = createClient({
        overrides: {
          getDefaultBranch: vi
            .fn<GitHubClient['getDefaultBranch']>()
            .mockRejectedValue(new Error('GitHub API error: 502')),
        },
      })

      let assessment = await assessCandidate(client, {
        ...CANDIDATE,
        release: releasedAt(TWO_YEARS_AGO),
        cooldown: COOL_DOWN,
        sha: SHA,
      })

      expect(assessment.reason).toBe('reachability-unknown')
    })
  })
})
