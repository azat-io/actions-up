import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../../types/github-client'
import type { Cooldown } from '../../../types/cooldown'
import type { TagInfo } from '../../../types/tag-info'

import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { getCompatibleUpdate } from '../../../core/api/get-compatible-update'
import { createMockClient } from '../../helpers/create-mock-client'

const NOW = Date.parse('2026-09-04T00:00:00.000Z')

const COOL_DOWN_MS = 7 * 24 * 60 * 60 * 1000

const COOL_DOWN: Cooldown = { minAgeMs: COOL_DOWN_MS, now: NOW }

const NEWEST_SHA = '805273f7cf5a6c5f549c155c4c9ea2a3f78711bd'

const MIDDLE_SHA = '7a77659a7a7a67d8387e6c494999a688e249db6c'

const OLDEST_SHA = 'a01a2d3bc2c9de000948b5a3a85b455b4f72d97a'

const RESOLVED_SHA = '0101ea7a85725b7e03969261d139b4f282b7a8f3'

const TIP_AT_CUTOFF = 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a'

/**
 * Publication date weeks before the cool-down ends.
 */
const OLD_ENOUGH = new Date('2026-07-31T00:00:00.000Z')

/**
 * Publication date two days before `NOW`, inside the cool-down.
 */
const TOO_YOUNG = new Date('2026-09-02T00:00:00.000Z')

/**
 * Moment the default branch moved to the tip it had at the start of the
 * cool-down.
 */
const ON_BRANCH_SINCE = new Date('2026-08-01T00:00:00.000Z')

/**
 * Tag of a fake repository.
 */
interface FakeTag {
  /**
   * Whether the default branch holds the commit. Defaults to true.
   */
  onDefaultBranch?: boolean

  /**
   * Whether the default branch already held the commit at the start of the
   * cool-down. Defaults to true.
   */
  heldAtCutoff?: boolean

  /**
   * Whether the listing leaves the commit out, as for an annotated tag listed
   * by name prefix.
   */
  unlisted?: boolean

  /**
   * Publication date of the release of the tag; no release when omitted.
   */
  publishedAt?: Date

  /**
   * Commit the tag points at, null when the tag points at no commit.
   */
  sha: string | null

  /**
   * Tag name.
   */
  tag: string
}

/**
 * Client of a repository with the given tags, listed newest first. Comparisons
 * with the default branch, now and at the start of the cool-down, answer per
 * commit, and no branch is protected.
 *
 * @param tags - Tags the repository holds, newest first.
 * @param overrides - Methods to replace.
 * @returns Mocked client.
 */
function createRepository(
  tags: FakeTag[],
  overrides: Partial<GitHubClient> = {},
): GitHubClient {
  let listing: TagInfo[] = tags.map(({ unlisted, tag, sha }) => ({
    sha: unlisted ? null : sha,
    tag,
  }))
  /**
   * Find the tag that points at a commit.
   *
   * @param sha - Commit to look for.
   * @returns The tag, if any.
   */
  function findBySha(sha: string): undefined | FakeTag {
    return tags.find(tag => tag.sha === sha)
  }

  return createMockClient({
    getReleaseByTag: vi.fn<GitHubClient['getReleaseByTag']>(
      (_owner, _repository, name) => {
        let found = tags.find(({ tag }) => tag === name)
        return Promise.resolve(
          found?.publishedAt ?
            {
              url: `https://github.com/actions/checkout/releases/tag/${name}`,
              publishedAt: found.publishedAt,
              isPrerelease: false,
              description: null,
              immutable: false,
              version: name,
              name,
            }
          : null,
        )
      },
    ),
    compareCommits: vi.fn<GitHubClient['compareCommits']>(
      (_owner, _repository, { base, head }) => {
        let found = findBySha(head)
        if (found?.onDefaultBranch === false) {
          return Promise.resolve('diverged')
        }
        return Promise.resolve(
          base === TIP_AT_CUTOFF && found?.heldAtCutoff === false ?
            'ahead'
          : 'behind',
        )
      },
    ),
    getMatchingTagReferences: vi
      .fn<GitHubClient['getMatchingTagReferences']>()
      .mockImplementation((_owner, _repository, prefix) =>
        Promise.resolve(listing.filter(({ tag }) => tag.startsWith(prefix))),
      ),
    getTagSha: vi.fn<GitHubClient['getTagSha']>((_owner, _repository, name) =>
      Promise.resolve(tags.find(({ tag }) => tag === name)?.sha ?? null),
    ),
    getBranchTipAt: vi.fn<GitHubClient['getBranchTipAt']>().mockResolvedValue({
      since: ON_BRANCH_SINCE,
      sha: TIP_AT_CUTOFF,
    }),
    getAllTags: vi.fn<GitHubClient['getAllTags']>().mockResolvedValue(listing),
    ...overrides,
  })
}

/**
 * Tags asked for a release lookup, in order.
 *
 * @param client - Mocked client.
 * @returns Tag names.
 */
function datedTags(client: GitHubClient): string[] {
  return vi.mocked(client.getReleaseByTag).mock.calls.map(([, , tag]) => tag)
}

describe('getCompatibleUpdate', () => {
  it('finds nothing for a reference that is not a version, without listing tags', async () => {
    let client = createRepository([])

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'main',
      cooldown: null,
      mode: 'minor',
    })

    expect(result).toStrictEqual({ selected: null, held: [] })
    expect(client.getAllTags).not.toHaveBeenCalled()
    expect(client.getMatchingTagReferences).not.toHaveBeenCalled()
  })

  it.each([
    { description: 'without a slash', actionName: 'checkout' },
    { description: 'without an owner', actionName: '/checkout' },
    { description: 'without a repository', actionName: 'actions/' },
  ])(
    'finds nothing for an action name $description',
    async ({ actionName }) => {
      let client = createRepository([{ sha: NEWEST_SHA, tag: 'v1.1.0' }])

      let result = await getCompatibleUpdate(client, {
        currentVersion: 'v1.0.0',
        cooldown: null,
        mode: 'minor',
        actionName,
      })

      expect(result).toStrictEqual({ selected: null, held: [] })
    },
  )

  it('finds nothing when the tag listing fails', async () => {
    let client = createRepository([], {
      getAllTags: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    })

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(result).toStrictEqual({ selected: null, held: [] })
  })

  it.each([
    { listing: 'getAllTags' as const, currentVersion: 'v1.0.0' },
    {
      listing: 'getMatchingTagReferences' as const,
      currentVersion: 'actions-v0.1.1',
    },
  ])(
    'reports a rate-limited $listing listing instead of reading it as no candidate',
    async ({ currentVersion, listing }) => {
      let rateLimit = new GitHubRateLimitError(
        new Date('2026-09-04T01:00:00.000Z'),
      )
      let client = createRepository([], {
        [listing]: vi.fn().mockRejectedValue(rateLimit),
      })

      let lookup = getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        cooldown: null,
        currentVersion,
        mode: 'minor',
      })

      await expect(lookup).rejects.toBe(rateLimit)
    },
  )

  it('finds nothing when no listed tag is compatible', async () => {
    let client = createRepository([{ sha: NEWEST_SHA, tag: 'v2.0.0' }])

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(result).toStrictEqual({ selected: null, held: [] })
  })

  it('offers the newest compatible tag with the commit from the listing, checked against the default branch', async () => {
    let client = createRepository([
      { sha: NEWEST_SHA, tag: 'v1.2.0' },
      { sha: OLDEST_SHA, tag: 'v1.1.0' },
    ])

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(result).toStrictEqual({
      selected: {
        assessment: {
          immutableRelease: null,
          effectiveDate: null,
          publishedAt: null,
          ageSource: null,
          sha: NEWEST_SHA,
          reason: null,
        },
        version: 'v1.2.0',
      },
      held: [],
    })
    expect(client.compareCommits).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      { base: 'refs/heads/main', head: NEWEST_SHA },
    )
    expect(client.getTagSha).not.toHaveBeenCalled()
    expect(client.getReleaseByTag).not.toHaveBeenCalled()
  })

  it.each([
    { mode: 'major' as const, expected: 'v2.0.0' },
    { mode: 'minor' as const, expected: 'v1.2.0' },
    { mode: 'patch' as const, expected: 'v1.0.5' },
  ])(
    'offers the newest tag that the $mode mode allows',
    async ({ expected, mode }) => {
      let client = createRepository([
        { sha: NEWEST_SHA, tag: 'v2.0.0' },
        { sha: MIDDLE_SHA, tag: 'v1.2.0' },
        { sha: OLDEST_SHA, tag: 'v1.0.5' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: null,
        mode,
      })

      expect(result.selected?.version).toBe(expected)
    },
  )

  it('starts below the latest version, which the caller already assessed, and never rises above it', async () => {
    let client = createRepository([
      { sha: 'b'.repeat(40), tag: 'v1.3.0' },
      { sha: NEWEST_SHA, tag: 'v1.2.0' },
      { sha: OLDEST_SHA, tag: 'v1.1.0' },
    ])

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      latestVersion: 'v1.2.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(result.selected?.version).toBe('v1.1.0')
  })

  it('reads the commit of a tag the listing leaves out from its tag reference', async () => {
    let client = createRepository([
      { tag: 'actions-v0.2.0', sha: RESOLVED_SHA, unlisted: true },
    ])

    let result = await getCompatibleUpdate(client, {
      currentVersion: 'actions-v0.1.1',
      actionName: 'actions/checkout',
      cooldown: null,
      mode: 'minor',
    })

    expect(result.selected?.assessment.sha).toBe(RESOLVED_SHA)
    expect(client.getMatchingTagReferences).toHaveBeenCalledWith(
      'actions',
      'checkout',
      'actions-',
    )
  })

  it('steps past a tag that points at no commit', async () => {
    let client = createRepository([
      { unlisted: true, tag: 'v1.2.0', sha: null },
      { sha: OLDEST_SHA, tag: 'v1.1.0' },
    ])

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(result).toMatchObject({
      selected: { version: 'v1.1.0' },
      held: [],
    })
  })

  it('stops at a tag whose reference cannot be read, offering no older tag', async () => {
    let client = createRepository(
      [
        { sha: NEWEST_SHA, unlisted: true, tag: 'v1.2.0' },
        { sha: OLDEST_SHA, tag: 'v1.1.0' },
      ],
      {
        getTagSha: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
      },
    )

    let result = await getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(result).toStrictEqual({
      held: [{ reason: 'sha-unresolved', version: 'v1.2.0', sha: null }],
      selected: null,
    })
  })

  it('reports a rate-limited commit lookup instead of offering the tag', async () => {
    let rateLimit = new GitHubRateLimitError(
      new Date('2026-09-04T01:00:00.000Z'),
    )
    let client = createRepository(
      [{ sha: NEWEST_SHA, unlisted: true, tag: 'v1.2.0' }],
      { getTagSha: vi.fn().mockRejectedValue(rateLimit) },
    )

    let lookup = getCompatibleUpdate(client, {
      actionName: 'actions/checkout',
      currentVersion: 'v1.0.0',
      cooldown: null,
      mode: 'minor',
    })

    await expect(lookup).rejects.toBe(rateLimit)
  })

  it('lists the tags of the repository that an action path belongs to', async () => {
    let client = createRepository([{ sha: NEWEST_SHA, tag: 'v3.1.0' }])

    await getCompatibleUpdate(client, {
      actionName: 'github/codeql-action/init',
      currentVersion: 'v3.0.0',
      cooldown: null,
      mode: 'minor',
    })

    expect(client.getAllTags).toHaveBeenCalledWith(
      'github',
      'codeql-action',
      100,
    )
  })

  describe('with a cool-down', () => {
    it('steps down to the newest tag that clears the cool-down, without dating older tags', async () => {
      let client = createRepository([
        { publishedAt: TOO_YOUNG, sha: NEWEST_SHA, tag: 'v1.3.0' },
        { publishedAt: OLD_ENOUGH, sha: MIDDLE_SHA, tag: 'v1.2.0' },
        { publishedAt: OLD_ENOUGH, sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result).toStrictEqual({
        selected: {
          assessment: {
            effectiveDate: ON_BRANCH_SINCE,
            publishedAt: OLD_ENOUGH,
            immutableRelease: false,
            ageSource: 'branch',
            sha: MIDDLE_SHA,
            reason: null,
          },
          version: 'v1.2.0',
        },
        held: [{ reason: 'cool-down', version: 'v1.3.0', sha: NEWEST_SHA }],
      })
      expect(datedTags(client)).toStrictEqual(['v1.3.0', 'v1.2.0'])
    })

    it('holds back every compatible tag that is too young', async () => {
      let client = createRepository([
        { publishedAt: TOO_YOUNG, sha: NEWEST_SHA, tag: 'v1.2.0' },
        { publishedAt: TOO_YOUNG, sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result).toStrictEqual({
        held: [
          { reason: 'cool-down', version: 'v1.2.0', sha: NEWEST_SHA },
          { reason: 'cool-down', version: 'v1.1.0', sha: OLDEST_SHA },
        ],
        selected: null,
      })
    })

    it.each([
      { expected: 'v1.1.0', outcome: 'offers', offset: 0 },
      { expected: 'v1.1.0', outcome: 'offers', offset: 1 },
      { outcome: 'holds back', expected: undefined, offset: -1 },
    ])(
      '$outcome a tag published the cool-down ago, shifted by $offset ms',
      async ({ expected, offset }) => {
        let client = createRepository([
          {
            publishedAt: new Date(NOW - COOL_DOWN_MS - offset),
            sha: OLDEST_SHA,
            tag: 'v1.1.0',
          },
        ])

        let result = await getCompatibleUpdate(client, {
          actionName: 'actions/checkout',
          currentVersion: 'v1.0.0',
          cooldown: COOL_DOWN,
          mode: 'minor',
        })

        expect(result.selected?.version).toBe(expected)
      },
    )

    it('stops at a tag whose date cannot be established, offering no older tag', async () => {
      let client = createRepository(
        [
          { publishedAt: OLD_ENOUGH, sha: NEWEST_SHA, tag: 'v1.2.0' },
          { publishedAt: OLD_ENOUGH, sha: OLDEST_SHA, tag: 'v1.1.0' },
        ],
        {
          getReleaseByTag: vi
            .fn()
            .mockRejectedValue(new Error('GitHub API error: 502')),
        },
      )

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result).toStrictEqual({
        held: [{ reason: 'age-unknown', version: 'v1.2.0', sha: NEWEST_SHA }],
        selected: null,
      })
    })

    it('reports a rate-limited date lookup instead of treating the tag as old enough', async () => {
      let rateLimit = new GitHubRateLimitError(
        new Date('2026-09-04T01:00:00.000Z'),
      )
      let client = createRepository(
        [{ publishedAt: OLD_ENOUGH, sha: NEWEST_SHA, tag: 'v1.2.0' }],
        { getReleaseByTag: vi.fn().mockRejectedValue(rateLimit) },
      )

      let lookup = getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      await expect(lookup).rejects.toBe(rateLimit)
    })

    it('honours the mode while stepping down for the cool-down', async () => {
      let client = createRepository([
        { publishedAt: OLD_ENOUGH, sha: NEWEST_SHA, tag: 'v2.0.0' },
        { publishedAt: TOO_YOUNG, sha: MIDDLE_SHA, tag: 'v1.2.0' },
        { publishedAt: OLD_ENOUGH, sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result.selected?.version).toBe('v1.1.0')
    })
  })

  describe('trust checks', () => {
    it('steps past an old release whose commit reached the default branch only inside the cool-down, however it is dated', async () => {
      let client = createRepository([
        {
          publishedAt: OLD_ENOUGH,
          heldAtCutoff: false,
          sha: NEWEST_SHA,
          tag: 'v1.2.0',
        },
        { publishedAt: OLD_ENOUGH, sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result).toMatchObject({
        held: [{ reason: 'cool-down', version: 'v1.2.0', sha: NEWEST_SHA }],
        selected: { version: 'v1.1.0' },
      })
    })

    it('steps past a tag whose commit is outside the history of the repository, whatever the cool-down', async () => {
      let client = createRepository([
        { onDefaultBranch: false, sha: NEWEST_SHA, tag: 'v1.2.0' },
        { sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: null,
        mode: 'minor',
      })

      expect(result).toMatchObject({
        held: [
          { reason: 'unreachable-commit', version: 'v1.2.0', sha: NEWEST_SHA },
        ],
        selected: { version: 'v1.1.0' },
      })
    })

    it('does not report again a tag whose resolved commit is already known to be outside the history', async () => {
      let client = createRepository([
        { onDefaultBranch: false, sha: NEWEST_SHA, tag: 'v1.3.0' },
        {
          onDefaultBranch: false,
          sha: NEWEST_SHA,
          unlisted: true,
          tag: 'v1.2.1',
        },
        { sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: null,
        mode: 'minor',
      })

      expect(result).toMatchObject({
        held: [
          { reason: 'unreachable-commit', version: 'v1.3.0', sha: NEWEST_SHA },
        ],
        selected: { version: 'v1.1.0' },
      })
      expect(result.held).toHaveLength(1)
    })

    it('gives up after three distinct commits fail a trust check, counting those the caller held back', async () => {
      let client = createRepository([
        { onDefaultBranch: false, sha: 'c'.repeat(40), tag: 'v1.5.0' },
        { onDefaultBranch: false, sha: 'd'.repeat(40), tag: 'v1.4.0' },
        { onDefaultBranch: false, sha: 'e'.repeat(40), tag: 'v1.3.0' },
        { sha: OLDEST_SHA, tag: 'v1.1.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        held: [
          {
            reason: 'unreachable-commit',
            sha: 'f'.repeat(40),
            version: 'v1.6.0',
          },
        ],
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        latestVersion: 'v1.6.0',
        cooldown: null,
        mode: 'minor',
      })

      expect(result.selected).toBeNull()
      expect(result.held.map(({ version }) => version)).toStrictEqual([
        'v1.5.0',
        'v1.4.0',
      ])
    })

    it('holds a floating tag back with the young release whose commit it points at', async () => {
      let client = createRepository([
        {
          publishedAt: TOO_YOUNG,
          heldAtCutoff: false,
          sha: NEWEST_SHA,
          tag: 'v1.3.0',
        },
        { sha: NEWEST_SHA, tag: 'v1.3' },
        { publishedAt: OLD_ENOUGH, sha: OLDEST_SHA, tag: 'v1.2.0' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result).toMatchObject({
        held: [
          { reason: 'cool-down', version: 'v1.3.0', sha: NEWEST_SHA },
          { reason: 'cool-down', version: 'v1.3', sha: NEWEST_SHA },
        ],
        selected: { version: 'v1.2.0' },
      })
      expect(datedTags(client)).toStrictEqual(['v1.3.0', 'v1.3', 'v1.2.0'])
    })

    it('offers an older release at the commit of a young release once the branch proves the commit old', async () => {
      let client = createRepository([
        { publishedAt: TOO_YOUNG, sha: NEWEST_SHA, tag: 'v1.3.0' },
        { publishedAt: OLD_ENOUGH, sha: NEWEST_SHA, tag: 'v1.2.9' },
        { publishedAt: OLD_ENOUGH, sha: OLDEST_SHA, tag: 'v1.2.8' },
      ])

      let result = await getCompatibleUpdate(client, {
        actionName: 'actions/checkout',
        currentVersion: 'v1.0.0',
        cooldown: COOL_DOWN,
        mode: 'minor',
      })

      expect(result.selected).toMatchObject({
        assessment: {
          publishedAt: OLD_ENOUGH,
          ageSource: 'branch',
          sha: NEWEST_SHA,
        },
        version: 'v1.2.9',
      })
    })

    it('holds back every tag at a commit the caller found outside the history, without a request', async () => {
      let client = createRepository([
        { sha: NEWEST_SHA, tag: 'v45.0.6' },
        { sha: NEWEST_SHA, tag: 'v45.0.5' },
        { sha: NEWEST_SHA, tag: 'v45.0.4' },
      ])

      let result = await getCompatibleUpdate(client, {
        held: [
          {
            reason: 'unreachable-commit',
            version: 'v45.0.7',
            sha: NEWEST_SHA,
          },
        ],
        actionName: 'tj-actions/changed-files',
        currentVersion: 'v45.0.0',
        latestVersion: 'v45.0.7',
        cooldown: COOL_DOWN,
        mode: 'patch',
      })

      expect(result).toStrictEqual({ selected: null, held: [] })
      expect(client.getReleaseByTag).not.toHaveBeenCalled()
      expect(client.compareCommits).not.toHaveBeenCalled()
    })

    it('judges a tag at the commit a moved tag points at by its own checks', async () => {
      let client = createRepository([
        { publishedAt: OLD_ENOUGH, sha: NEWEST_SHA, tag: 'v45.0.6' },
      ])

      let result = await getCompatibleUpdate(client, {
        held: [{ reason: 'tag-moved', version: 'v45.0.7', sha: NEWEST_SHA }],
        actionName: 'tj-actions/changed-files',
        currentVersion: 'v45.0.0',
        latestVersion: 'v45.0.7',
        cooldown: COOL_DOWN,
        mode: 'patch',
      })

      expect(result).toMatchObject({
        selected: { version: 'v45.0.6' },
        held: [],
      })
    })
  })
})
