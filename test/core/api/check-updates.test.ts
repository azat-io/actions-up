import type { Mock } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'
import type { GitHubClient } from '../../../types/github-client'
import type { ReleaseInfo } from '../../../types/release-info'
import type { TagInfo } from '../../../types/tag-info'

import {
  makeReferencePayload,
  makeReleasePayload,
  routeFetch,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { checkUpdates } from '../../../core/api/check-updates'

/**
 * State of a repository as the fake GitHub client reports it. A lookup the
 * state does not mention answers as if the repository had nothing; a lookup
 * answered with an error fails with that error.
 */
interface FakeRepo {
  /**
   * Answer of `getRefType` per reference. References not listed exist as tags,
   * as the references written in workflows normally do.
   */
  referenceTypes?: Record<string, 'branch' | 'tag' | Error | null>

  /**
   * Answer of `getTagInfo` per tag name.
   */
  tagInfo?: Record<string, TagInfo | Error | null>

  /**
   * Answer of `getTagSha` per tag name.
   */
  tagShas?: Record<string, string | Error | null>

  /**
   * Answer of `getLatestRelease`.
   */
  latestRelease?: ReleaseInfo | Error | null

  /**
   * Releases, newest first, which `getAllReleases` lists up to its limit.
   */
  releases?: ReleaseInfo[]

  /**
   * Tag references `getMatchingTagReferences` filters by prefix. As in the real
   * API, an annotated tag carries a null SHA there.
   */
  references?: TagInfo[]

  /**
   * Tags, newest first, which `getAllTags` lists up to its limit.
   */
  tags?: TagInfo[]
}

/**
 * Options of `checkUpdates` other than the client.
 */
type CheckOptions = Omit<
  NonNullable<Parameters<typeof checkUpdates>[2]>,
  'client'
>

/**
 * GitHub client whose methods are typed mocks.
 */
type FakeClient = {
  [Method in keyof GitHubClient]: Mock<GitHubClient[Method]>
}

/**
 * Create a fake GitHub client answering each lookup from the state of the
 * requested repository.
 *
 * @param findRepo - Returns the state of a repository.
 * @returns Fake GitHub client.
 */
function makeFakeClient(
  findRepo: (owner: string, repo: string) => FakeRepo,
): FakeClient {
  return {
    getRefType: vi.fn<GitHubClient['getRefType']>((owner, repo, reference) => {
      let { referenceTypes = {} } = findRepo(owner, repo)
      return settle(
        Object.hasOwn(referenceTypes, reference) ?
          (referenceTypes[reference] ?? null)
        : 'tag',
      )
    }),
    getMatchingTagReferences: vi.fn<GitHubClient['getMatchingTagReferences']>(
      (owner, repo, prefix) =>
        Promise.resolve(
          (findRepo(owner, repo).references ?? []).filter(reference =>
            reference.tag.startsWith(prefix),
          ),
        ),
    ),
    getAllReleases: vi.fn<GitHubClient['getAllReleases']>(
      (owner, repo, limit) =>
        Promise.resolve((findRepo(owner, repo).releases ?? []).slice(0, limit)),
    ),
    getRateLimitStatus: vi.fn<GitHubClient['getRateLimitStatus']>(() => ({
      resetAt: new Date('2026-01-15T10:00:00Z'),
      remaining: 5000,
    })),
    getAllTags: vi.fn<GitHubClient['getAllTags']>((owner, repo, limit) =>
      Promise.resolve((findRepo(owner, repo).tags ?? []).slice(0, limit)),
    ),
    getLatestRelease: vi.fn<GitHubClient['getLatestRelease']>((owner, repo) =>
      settle(findRepo(owner, repo).latestRelease ?? null),
    ),
    getTagInfo: vi.fn<GitHubClient['getTagInfo']>((owner, repo, tag) =>
      settle(findRepo(owner, repo).tagInfo?.[tag] ?? null),
    ),
    getTagSha: vi.fn<GitHubClient['getTagSha']>((owner, repo, tag) =>
      settle(findRepo(owner, repo).tagShas?.[tag] ?? null),
    ),
    shouldWaitForRateLimit: vi.fn<GitHubClient['shouldWaitForRateLimit']>(
      () => false,
    ),
  }
}

/**
 * Build the update `checkUpdates` reports for an action occurrence: by default
 * a checked tag reference for which no newer version was found.
 *
 * @param action - Action occurrence the update belongs to.
 * @param overrides - Fields that differ from the default.
 * @returns Update with every field the check reports.
 */
function expectedUpdate(
  action: GitHubAction,
  overrides: Partial<ActionUpdate> = {},
): ActionUpdate {
  return {
    currentVersion: action.version ?? null,
    currentRefType: 'tag',
    skipReason: undefined,
    latestVersion: null,
    publishedAt: null,
    isBreaking: false,
    hasUpdate: false,
    latestSha: null,
    status: 'ok',
    action,
    ...overrides,
  }
}

/**
 * Create a release as the GitHub client normalizes it.
 *
 * @param overrides - Fields to replace.
 * @returns Release information.
 */
function makeRelease(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  let version = overrides.version ?? 'v1.0.0'
  return {
    url: `https://github.com/owner/repo/releases/tag/${version}`,
    publishedAt: new Date('2024-01-01T00:00:00Z'),
    isPrerelease: false,
    description: null,
    name: version,
    sha: null,
    version,
    ...overrides,
  }
}

/**
 * Create an action occurrence as the workflow scanner reports it.
 *
 * @param overrides - Fields to replace.
 * @returns Action occurrence.
 */
function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    file: '.github/workflows/ci.yml',
    name: 'owner/repo',
    version: 'v1.0.0',
    type: 'external',
    line: 12,
    ...overrides,
  }
}

/**
 * Create a tag as the tags listing reports it: a name and its commit SHA.
 *
 * @param overrides - Fields to replace.
 * @returns Tag information.
 */
function makeTag(overrides: Partial<TagInfo> = {}): TagInfo {
  return {
    sha: 'c5500c31990360ec57059355f4603cf8992cf126',
    message: null,
    tag: 'v1.0.0',
    date: null,
    ...overrides,
  }
}

/**
 * Check actions with the given client and without a token, the way the CLI
 * passes the client it created.
 *
 * @param client - GitHub client to query.
 * @param actions - Action occurrences to check.
 * @param options - Options other than the client.
 * @returns Updates reported for the actions.
 */
function check(
  client: GitHubClient,
  actions: GitHubAction[],
  options: CheckOptions = {},
): Promise<ActionUpdate[]> {
  return checkUpdates(actions, undefined, { ...options, client })
}

/**
 * Settle a fake lookup: an error rejects, any other answer resolves.
 *
 * @param answer - Answer or error the lookup produces.
 * @returns Promise settled with the answer.
 */
function settle<Answer>(answer: Answer | Error): Promise<Answer> {
  return answer instanceof Error ?
      Promise.reject(answer)
    : Promise.resolve(answer)
}

/**
 * Create a fake GitHub client that answers each repository from its own state,
 * keyed by `owner/repo`. Repositories not listed have nothing.
 *
 * @param repos - State of each repository.
 * @returns Fake GitHub client.
 */
function makeClientForRepos(repos: Record<string, FakeRepo>): FakeClient {
  return makeFakeClient((owner, repo) => repos[`${owner}/${repo}`] ?? {})
}

/**
 * Create the error the GitHub client throws once the rate limit is exhausted.
 *
 * @returns Error announcing when the rate limit resets.
 */
function makeRateLimitError(): GitHubRateLimitError {
  return new GitHubRateLimitError(new Date('2026-01-15T10:00:00Z'))
}

/**
 * Create a fake GitHub client that answers every repository from one state.
 *
 * @param repo - State of the repository.
 * @returns Fake GitHub client.
 */
function makeClient(repo: FakeRepo = {}): FakeClient {
  return makeFakeClient(() => repo)
}

/**
 * Text the workflow scanner records for a trailing `# text` comment on a
 * `uses:` line: everything after the `#`, so it keeps the leading space.
 *
 * @param text - Comment text written after `# `.
 * @returns Comment as the scanner stores it on the action.
 */
function inlineComment(text: string): string {
  return ` ${text}`
}

describe('checkUpdates', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
  })

  it('authenticates the requests of its own client with the token when no client is provided', async () => {
    let api = routeFetch({
      '/repos/actions/checkout/git/ref/tags/v4.2.2': ok(
        makeReferencePayload('refs/tags/v4.2.2', {
          sha: '0c9cf1022529583a37d96f16ad80090459a3a1f5',
          type: 'commit',
        }),
      ),
      '/repos/actions/checkout/releases/latest': ok(makeReleasePayload()),
    })
    let action = makeAction({ name: 'actions/checkout', version: 'v4.0.0' })

    await checkUpdates([action], 'ghp_16C7e42F292c6912E7710c838347Ae178B4a')

    expect(api.headers).toStrictEqual([
      expect.objectContaining({
        authorization: 'Bearer ghp_16C7e42F292c6912E7710c838347Ae178B4a',
      }),
      expect.objectContaining({
        authorization: 'Bearer ghp_16C7e42F292c6912E7710c838347Ae178B4a',
      }),
    ])
  })

  describe('action types', () => {
    it.each([
      { name: 'owner/repo', type: 'external' } as const,
      {
        name: 'owner/repo/.github/workflows/build.yml',
        type: 'reusable-workflow',
      } as const,
    ])(
      'checks $type references against the latest release',
      async ({ name, type }) => {
        let release = makeRelease({ version: 'v1.1.0' })
        let client = makeClient({ latestRelease: release })
        let action = makeAction({ version: 'v1.0.0', name, type })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            latestVersion: 'v1.1.0',
            hasUpdate: true,
          }),
        ])
      },
    )

    it.each([
      {
        name: './.github/actions/build',
        version: undefined,
        type: 'local',
      } as const,
      {
        name: 'docker://alpine:3.20',
        version: undefined,
        type: 'docker',
      } as const,
      {
        name: './.github/actions/setup',
        version: undefined,
        type: 'composite',
      } as const,
      {
        version: 'ubuntu-22.04',
        name: 'runner/ubuntu',
        type: 'runner',
      } as const,
    ])('does not check $type references', async ({ version, name, type }) => {
      let client = makeClient({
        latestRelease: makeRelease({ version: 'v1.1.0' }),
      })
      let action = makeAction({ version, name, type })

      let result = await check(client, [action])

      expect(result).toEqual([])
    })
  })

  describe('occurrences', () => {
    it('reports every occurrence of an action pinned at the same reference and requests its repository once', async () => {
      let release = makeRelease({ version: 'v1.1.0' })
      let client = makeClient({ latestRelease: release })
      let inBuild = makeAction({ file: '.github/workflows/build.yml' })
      let inRelease = makeAction({ file: '.github/workflows/release.yml' })

      let result = await check(client, [inBuild, inRelease])

      expect(result).toEqual([
        expectedUpdate(inBuild, {
          publishedAt: release.publishedAt,
          latestVersion: 'v1.1.0',
          hasUpdate: true,
        }),
        expectedUpdate(inRelease, {
          publishedAt: release.publishedAt,
          latestVersion: 'v1.1.0',
          hasUpdate: true,
        }),
      ])
      expect(client.getLatestRelease).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
      )
    })

    it.each([
      { second: 'branch', first: 'tag' } as const,
      { first: 'branch', second: 'tag' } as const,
    ])(
      'checks a tag and a branch occurrence of one action independently when the $first comes first',
      async ({ second, first }) => {
        let release = makeRelease({ version: 'v4.2.0' })
        let client = makeClient({
          tagShas: { 'v4.2.0': 'b55d322140c858c13f460f44f4d1a034740953cb' },
          referenceTypes: { main: 'branch' },
          latestRelease: release,
        })
        let occurrences = {
          branch: makeAction({ version: 'main' }),
          tag: makeAction({ version: 'v4' }),
        }
        let expected = {
          tag: expectedUpdate(occurrences.tag, {
            latestSha: 'b55d322140c858c13f460f44f4d1a034740953cb',
            publishedAt: release.publishedAt,
            latestVersion: 'v4.2.0',
            hasUpdate: true,
          }),
          branch: expectedUpdate(occurrences.branch, {
            currentRefType: 'branch',
            skipReason: 'branch',
            status: 'skipped',
          }),
        }

        let result = await check(client, [
          occurrences[first],
          occurrences[second],
        ])

        expect(result).toEqual([expected[first], expected[second]])
      },
    )

    it('requests the repository data once when one action is pinned at several references', async () => {
      let client = makeClient({
        tags: [
          makeTag({
            sha: '0f298509e5acb1cb7161588de079829da577a355',
            tag: 'v4.2.0',
          }),
        ],
      })
      let older = makeAction({ version: 'v4.0.0' })
      let newer = makeAction({ version: 'v4.1.0' })

      let result = await check(client, [older, newer])

      expect(result).toEqual([
        expectedUpdate(older, {
          latestSha: '0f298509e5acb1cb7161588de079829da577a355',
          latestVersion: 'v4.2.0',
          hasUpdate: true,
        }),
        expectedUpdate(newer, {
          latestSha: '0f298509e5acb1cb7161588de079829da577a355',
          latestVersion: 'v4.2.0',
          hasUpdate: true,
        }),
      ])
      expect(client.getLatestRelease).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
      )
      expect(client.getAllReleases).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
        expect.any(Number),
      )
      expect(client.getAllTags).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
        expect.any(Number),
      )
    })
  })

  describe('references', () => {
    it('skips a branch reference unless branches are included', async () => {
      let client = makeClient({
        latestRelease: makeRelease({ version: 'v1.2.0' }),
        referenceTypes: { main: 'branch' },
      })
      let action = makeAction({ version: 'main' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          currentRefType: 'branch',
          skipReason: 'branch',
          status: 'skipped',
        }),
      ])
    })

    it.each([
      { scenario: 'by default', options: {} },
      {
        options: { includeBranches: true },
        scenario: 'with branches included',
      },
    ])(
      'skips a reference whose type lookup failed $scenario',
      async ({ options }) => {
        let client = makeClient({
          referenceTypes: {
            main: new Error('GitHub API error: 502 Bad Gateway'),
          },
          latestRelease: makeRelease({ version: 'v1.2.0' }),
        })
        let action = makeAction({ version: 'main' })

        let result = await check(client, [action], options)

        expect(result).toEqual([
          expectedUpdate(action, {
            skipReason: 'ref-type-unavailable',
            currentRefType: 'unknown',
            status: 'skipped',
          }),
        ])
      },
    )

    it('checks an included branch named like a tag family against the latest release', async () => {
      let release = makeRelease({ version: 'v1.2.3' })
      let client = makeClient({
        tagShas: { 'v1.2.3': 'c1f6ec77fe2fb216a73b8d67b9349fc28c959f31' },
        referenceTypes: { 'release/v1': 'branch' },
        latestRelease: release,
      })
      let action = makeAction({ version: 'release/v1' })

      let result = await check(client, [action], { includeBranches: true })

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'c1f6ec77fe2fb216a73b8d67b9349fc28c959f31',
          publishedAt: release.publishedAt,
          currentRefType: 'branch',
          latestVersion: 'v1.2.3',
          hasUpdate: true,
        }),
      ])
    })

    it.each([
      {
        scenario: 'another reference',
        outcome: 'reports an update',
        latest: 'v1.2.3',
        hasUpdate: true,
        branch: 'main',
      },
      {
        scenario: 'the branch itself',
        outcome: 'reports no update',
        hasUpdate: false,
        latest: 'stable',
        branch: 'stable',
      },
    ])(
      '$outcome for an included branch when the latest release names $scenario',
      async ({ hasUpdate, latest, branch }) => {
        let release = makeRelease({ version: latest })
        let client = makeClient({
          tags: [
            makeTag({
              sha: '4e9a3448c1b2946987d6dca7f4672e2db482a2be',
              tag: latest,
            }),
          ],
          tagShas: { [latest]: '4e9a3448c1b2946987d6dca7f4672e2db482a2be' },
          referenceTypes: { [branch]: 'branch' },
          latestRelease: release,
        })
        let action = makeAction({ version: branch })

        let result = await check(client, [action], { includeBranches: true })

        expect(result).toEqual([
          expectedUpdate(action, {
            latestSha: '4e9a3448c1b2946987d6dca7f4672e2db482a2be',
            publishedAt: release.publishedAt,
            currentRefType: 'branch',
            latestVersion: latest,
            hasUpdate,
          }),
        ])
      },
    )

    it.each([
      { currentRefType: 'tag', answer: 'tag' } as const,
      { currentRefType: 'unknown', answer: null } as const,
    ])(
      'reports a reference without a version as $currentRefType when the type lookup answers $answer',
      async ({ currentRefType, answer }) => {
        let release = makeRelease({ version: 'v1.0.0' })
        let client = makeClient({
          referenceTypes: { stable: answer },
          latestRelease: release,
        })
        let action = makeAction({ version: 'stable' })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            skipReason: 'not-comparable',
            latestVersion: 'v1.0.0',
            status: 'skipped',
            currentRefType,
          }),
        ])
      },
    )
  })

  describe('latest release', () => {
    it.each([
      {
        latestSha: '1c6c3310aa69e3841dd86243cfc8ea84e3a12bbd',
        tagSha: '1c6c3310aa69e3841dd86243cfc8ea84e3a12bbd',
        source: 'its resolved tag',
      },
      {
        latestSha: 'b13402ff6d5bf94ee34523e6422149f92689a931',
        source: 'the release when its tag is unresolved',
        tagSha: null,
      },
    ])(
      'takes the commit of the latest release from $source',
      async ({ latestSha, tagSha }) => {
        let release = makeRelease({
          sha: 'b13402ff6d5bf94ee34523e6422149f92689a931',
          version: 'v5.1.0',
        })
        let client = makeClient({
          tagShas: { 'v5.1.0': tagSha },
          latestRelease: release,
        })
        let action = makeAction({ version: 'v5.0.0' })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            latestVersion: 'v5.1.0',
            hasUpdate: true,
            latestSha,
          }),
        ])
      },
    )

    it('falls back to the newest listed release when the repository has no latest release', async () => {
      let newest = makeRelease({
        sha: 'cef02ee8868cd89152cc2af0ba4c8bdf2c13b14d',
        publishedAt: new Date('2024-03-01T00:00:00Z'),
        version: 'v1.5.0',
      })
      let client = makeClient({
        releases: [newest, makeRelease({ version: 'v1.4.0' })],
      })
      let action = makeAction({ version: 'v1.0.0' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'cef02ee8868cd89152cc2af0ba4c8bdf2c13b14d',
          publishedAt: newest.publishedAt,
          latestVersion: 'v1.5.0',
          hasUpdate: true,
        }),
      ])
    })

    it('trusts a latest release with a full version over higher tags by default', async () => {
      let release = makeRelease({
        publishedAt: new Date('2022-03-09T18:52:42Z'),
        version: 'v12.1347.0',
      })
      let client = makeClient({
        tags: [
          makeTag({
            sha: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
            tag: 'v12.3119.0',
          }),
          makeTag({
            sha: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
            tag: 'v12.1347.0',
          }),
        ],
        tagShas: { 'v12.1347.0': '99bb2caf247dfd9f03cf984373bc6043d4e32ebf' },
        latestRelease: release,
      })
      let action = makeAction({
        version: 'b4f3ffa8ce12d80bc1b3351afc3179fb0027db1e',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          publishedAt: release.publishedAt,
          latestVersion: 'v12.1347.0',
          currentRefType: 'sha',
          hasUpdate: true,
        }),
      ])
    })

    it('prefers a higher tag over the latest release with preferTags', async () => {
      let client = makeClient({
        tags: [
          makeTag({
            sha: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
            tag: 'v12.3119.0',
          }),
          makeTag({
            sha: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
            tag: 'v12.1347.0',
          }),
        ],
        latestRelease: makeRelease({
          publishedAt: new Date('2022-03-09T18:52:42Z'),
          version: 'v12.1347.0',
        }),
        tagShas: { 'v12.1347.0': '99bb2caf247dfd9f03cf984373bc6043d4e32ebf' },
      })
      let onLatestTag = makeAction({
        version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      })
      let onRelease = makeAction({
        version: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
      })

      let result = await check(client, [onLatestTag, onRelease], {
        preferTags: true,
      })

      expect(result).toEqual([
        expectedUpdate(onLatestTag, {
          latestSha: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          latestVersion: 'v12.3119.0',
          currentRefType: 'sha',
        }),
        expectedUpdate(onRelease, {
          latestSha: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          latestVersion: 'v12.3119.0',
          currentRefType: 'sha',
          hasUpdate: true,
        }),
      ])
    })

    it.each([
      {
        tags: [
          makeTag({
            sha: '6389ae35759fd0fd2bd91b9506977de84ca54e7b',
            tag: 'v2.9.0',
          }),
        ],
        scenario: 'it outranks every tag',
      },
      {
        tags: [makeTag({ tag: 'nightly' }), makeTag({ tag: 'latest' })],
        scenario: 'no tag carries a version',
      },
    ])(
      'keeps the latest release with preferTags when $scenario',
      async ({ tags }) => {
        let release = makeRelease({ version: 'v3.0.0' })
        let client = makeClient({
          tagShas: { 'v3.0.0': 'a144493754fdb4c10fef817b135f970ce43d78cb' },
          latestRelease: release,
          tags,
        })
        let action = makeAction({ version: 'v2.0.0' })

        let result = await check(client, [action], { preferTags: true })

        expect(result).toEqual([
          expectedUpdate(action, {
            latestSha: 'a144493754fdb4c10fef817b135f970ce43d78cb',
            publishedAt: release.publishedAt,
            latestVersion: 'v3.0.0',
            isBreaking: true,
            hasUpdate: true,
          }),
        ])
      },
    )

    it('inspects the default window of most recent tags when the repository has no release', async () => {
      let expectedDefaultWindow = 30
      let client = makeClient()

      await check(client, [makeAction()])

      expect(client.getAllTags).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
        expectedDefaultWindow,
      )
    })

    it('compares the latest release with the documented window of most recent tags with preferTags', async () => {
      let expectedPreferTagsWindow = 100
      let client = makeClient({
        latestRelease: makeRelease({ version: 'v1.1.0' }),
      })

      await check(client, [makeAction()], { preferTags: true })

      expect(client.getAllTags).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
        expectedPreferTagsWindow,
      )
    })

    it.each([
      {
        tags: [
          makeTag({
            sha: 'f391e64e40672fb8b79cdf4b40b03e2f34de8077',
            tag: 'v1.2.3',
          }),
          makeTag({ tag: 'v1' }),
        ],
        latestSha: 'f391e64e40672fb8b79cdf4b40b03e2f34de8077',
        scenario: 'is newer',
        latest: 'v1.2.3',
        release: 'v1',
      },
      {
        tags: [
          makeTag({
            sha: '40bd317740d98f213ed644d3a877192b2f70c020',
            tag: 'v1.0.0',
          }),
          makeTag({ tag: 'v1' }),
        ],
        latestSha: '40bd317740d98f213ed644d3a877192b2f70c020',
        scenario: 'names the same version in full',
        latest: 'v1.0.0',
        release: 'v1',
      },
      {
        tags: [
          makeTag({
            sha: '9b9ee15766ad430c233f049e6e298afe592fa843',
            tag: '1.2.3',
          }),
          makeTag({ tag: '1' }),
        ],
        latestSha: '9b9ee15766ad430c233f049e6e298afe592fa843',
        scenario: 'is newer than a major without a v',
        latest: '1.2.3',
        release: '1',
      },
      {
        tags: [
          makeTag({
            sha: 'eb07008f96619fc8ad112eac07d5aed90edd8148',
            tag: 'v10.2.0',
          }),
          makeTag({ tag: 'v10' }),
        ],
        latestSha: 'eb07008f96619fc8ad112eac07d5aed90edd8148',
        scenario: 'is newer than a two-digit major',
        latest: 'v10.2.0',
        release: 'v10',
      },
    ])(
      'prefers a tag over a moving major release when the tag $scenario',
      async ({ latestSha, release, latest, tags }) => {
        let client = makeClient({
          latestRelease: makeRelease({ version: release }),
          tags,
        })
        let action = makeAction({ version: release })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: latest,
            hasUpdate: true,
            latestSha,
          }),
        ])
      },
    )

    it.each([
      {
        tags: [
          makeTag({
            sha: '197c1db02d3f90cc37dbf00061fb69864bce0655',
            tag: 'v2',
          }),
          makeTag({ tag: 'v1.9.0' }),
        ],
        scenario: 'its own tag is the newest version',
      },
      {
        tags: [makeTag({ tag: 'latest' }), makeTag({ tag: 'release' })],
        scenario: 'no tag carries a version',
      },
    ])('keeps a moving major release when $scenario', async ({ tags }) => {
      let release = makeRelease({ version: 'v2' })
      let client = makeClient({
        tagShas: { v2: '197c1db02d3f90cc37dbf00061fb69864bce0655' },
        latestRelease: release,
        tags,
      })
      let action = makeAction({ version: 'v2' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '197c1db02d3f90cc37dbf00061fb69864bce0655',
          publishedAt: release.publishedAt,
          latestVersion: 'v2',
          hasUpdate: true,
        }),
      ])
    })

    it.each([
      {
        tags: [
          makeTag({
            sha: 'f239b45f853308d1b52b3d1a2c3d1616c62e0cdd',
            tag: 'v1.1.0',
          }),
          makeTag({ tag: 'nightly' }),
        ],
        latestSha: 'f239b45f853308d1b52b3d1a2c3d1616c62e0cdd',
        scenario: 'carries no version',
        release: 'nightly',
        current: 'v1.0.0',
        latest: 'v1.1.0',
      },
      {
        tags: [
          makeTag({
            sha: '617692aaf4bae23bfb7bf8562ae1ff2ca77ef509',
            tag: 'v4.33.0',
          }),
          makeTag({ tag: 'v4.32.0' }),
          makeTag({ tag: 'release-bundle-v2.5.0' }),
        ],
        latestSha: '617692aaf4bae23bfb7bf8562ae1ff2ca77ef509',
        scenario: 'belongs to another tag family',
        release: 'release-bundle-v2.5.0',
        current: 'v4.32.0',
        latest: 'v4.33.0',
      },
    ])(
      'consults the tags when the latest release $scenario',
      async ({ latestSha, current, release, latest, tags }) => {
        let client = makeClient({
          latestRelease: makeRelease({ version: release }),
          tags,
        })
        let action = makeAction({ version: current })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: latest,
            hasUpdate: true,
            latestSha,
          }),
        ])
      },
    )

    it('skips a plain reference whose latest release belongs to another tag family', async () => {
      let release = makeRelease({ version: 'codeql-bundle-v2.20.0' })
      let client = makeClient({
        tags: [
          makeTag({
            sha: '1f733c1ffd8ce653777ea7f3499506f3b5c892b8',
            tag: 'codeql-bundle-v2.20.0',
          }),
        ],
        references: [
          makeTag({
            sha: 'd2cb86e7743926b54a5fa968710b58031ada504c',
            tag: 'v4.1.0',
          }),
        ],
        tagShas: {
          'codeql-bundle-v2.20.0': '1f733c1ffd8ce653777ea7f3499506f3b5c892b8',
        },
        latestRelease: release,
      })
      let action = makeAction({
        name: 'github/codeql-action/init',
        version: 'v4.0.0',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '1f733c1ffd8ce653777ea7f3499506f3b5c892b8',
          latestVersion: 'codeql-bundle-v2.20.0',
          publishedAt: release.publishedAt,
          skipReason: 'tag-family',
          status: 'skipped',
        }),
      ])
    })
  })

  describe('tags without a release', () => {
    it('falls back to the highest version tag when the repository has no release', async () => {
      let client = makeClient({
        tags: [
          makeTag({ tag: 'non-semver' }),
          makeTag({
            sha: 'cb22f3dc888b02785ef2a439c0b627cdb084b84f',
            tag: 'v1.1.0',
          }),
        ],
      })
      let action = makeAction({ version: 'v1.0.0' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'cb22f3dc888b02785ef2a439c0b627cdb084b84f',
          latestVersion: 'v1.1.0',
          hasUpdate: true,
        }),
      ])
    })

    it.each([
      {
        tags: [
          makeTag({
            sha: 'dd2f32667128e7ad3b95c1d250dc4841e95b4823',
            tag: 'nightly',
          }),
          makeTag({ tag: 'build-123' }),
        ],
        latestSha: 'dd2f32667128e7ad3b95c1d250dc4841e95b4823',
        scenario: 'a version pin takes the first tag',
        action: makeAction({ version: 'v1.0.0' }),
        skipReason: 'not-comparable',
        currentRefType: 'tag',
        latest: 'nightly',
      } as const,
      {
        tags: [
          makeTag({
            sha: 'dd2f32667128e7ad3b95c1d250dc4841e95b4823',
            tag: 'nightly',
          }),
        ],
        action: makeAction({
          version: '9e48671c30ce53c99c5acf31261a2f73230149fc',
          comment: inlineComment('v1.0.0'),
        }),
        latestSha: 'dd2f32667128e7ad3b95c1d250dc4841e95b4823',
        scenario: 'a SHA pin takes the first tag',
        skipReason: 'not-comparable',
        currentRefType: 'sha',
        latest: 'nightly',
      } as const,
      {
        tags: [
          makeTag({
            sha: '8501747d7f1ab520c2a0d16fc9cad64c2336370f',
            tag: 'nightly-v2.0.0',
          }),
        ],
        latestSha: '8501747d7f1ab520c2a0d16fc9cad64c2336370f',
        scenario: 'the first tag even from another family',
        action: makeAction({ version: 'v1.0.0' }),
        latest: 'nightly-v2.0.0',
        skipReason: 'tag-family',
        currentRefType: 'tag',
      } as const,
      {
        tags: [
          makeTag({ tag: 'actions-v2.0.0' }),
          makeTag({
            sha: 'a42ef9f6b760bc65eb8f899b613e1212fc5cfd72',
            tag: 'nightly',
          }),
        ],
        latestSha: 'a42ef9f6b760bc65eb8f899b613e1212fc5cfd72',
        scenario: 'a tag outside other families wins',
        action: makeAction({ version: 'v1.0.0' }),
        skipReason: 'not-comparable',
        currentRefType: 'tag',
        latest: 'nightly',
      } as const,
    ])(
      'falls back to a listed tag when no tag carries a comparable version: $scenario',
      async ({
        currentRefType,
        skipReason,
        latestSha,
        action,
        latest,
        tags,
      }) => {
        let client = makeClient({ tags: [...tags] })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: latest,
            status: 'skipped',
            currentRefType,
            skipReason,
            latestSha,
          }),
        ])
      },
    )

    /**
     * An eight-digit calendar tag is valid hexadecimal, so it passes the
     * semver-like check while carrying no comparable version. Comparing it used
     * to throw and fail the whole repository lookup, including for references
     * that had nothing to do with it.
     */
    it('ignores a SHA-shaped tag when picking the latest tag', async () => {
      let client = makeClient({
        tags: [
          makeTag({
            sha: 'afa2a7bff34bdc6f2d055633b8c306fe511247c7',
            tag: 'v1.2.4',
          }),
          makeTag({ tag: '20240101' }),
          makeTag({ tag: 'v1.2.3' }),
        ],
      })
      let action = makeAction({ name: 'acme/action', version: 'v1.2.3' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'afa2a7bff34bdc6f2d055633b8c306fe511247c7',
          latestVersion: 'v1.2.4',
          hasUpdate: true,
        }),
      ])
    })

    /**
     * A repository whose tags are all calendar dates leaves nothing comparable
     * to pick, so the reference is reported rather than rewritten.
     */
    it('reports a repository that publishes only SHA-shaped tags', async () => {
      let client = makeClient({
        tags: [
          makeTag({
            sha: '8c2a3394a13f87438b1b0a3016cc351ccc301325',
            tag: '20250301',
          }),
          makeTag({ tag: '20240101' }),
        ],
      })
      let action = makeAction({ name: 'acme/action', version: '20240101' })

      let result = await check(client, [action])

      expect(result).toMatchObject([
        {
          latestSha: '8c2a3394a13f87438b1b0a3016cc351ccc301325',
          skipReason: 'not-comparable',
          currentVersion: '20240101',
          latestVersion: '20250301',
          status: 'skipped',
          hasUpdate: false,
        },
      ])
    })
  })

  describe('when a tag beats a moving major release', () => {
    it.each([
      {
        tagInfo: makeTag({
          sha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
          date: new Date('2024-06-01T00:00:00Z'),
          message: 'Release notes',
          tag: 'v1.2.3',
        }),
        latestSha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
        source: 'the tag metadata ahead of the listing',
        publishedAt: new Date('2024-06-01T00:00:00Z'),
      },
      {
        latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
        source: 'the listing when the tag has no metadata',
        publishedAt: null,
        tagInfo: null,
      },
      {
        latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
        source: 'the listing when the network fails',
        tagInfo: new TypeError('fetch failed'),
        publishedAt: null,
      },
    ])(
      'takes the latest commit from $source',
      async ({ publishedAt, latestSha, tagInfo }) => {
        let client = makeClient({
          tags: [
            makeTag({
              sha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
              tag: 'v1.2.3',
            }),
            makeTag({ tag: 'v1' }),
          ],
          latestRelease: makeRelease({ version: 'v1' }),
          tagInfo: { 'v1.2.3': tagInfo },
        })
        let action = makeAction({ version: 'v1' })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: 'v1.2.3',
            hasUpdate: true,
            publishedAt,
            latestSha,
          }),
        ])
      },
    )

    it('reports a rate limit hit while reading the tag metadata', async () => {
      let client = makeClient({
        tags: [makeTag({ tag: 'v1.2.3' }), makeTag({ tag: 'v1' })],
        latestRelease: makeRelease({ version: 'v1' }),
        tagInfo: { 'v1.2.3': makeRateLimitError() },
      })
      let action = makeAction({ version: 'v1' })

      await expect(check(client, [action])).rejects.toMatchObject({
        name: 'GitHubRateLimitError',
      })
    })
  })

  describe('when the repository publishes no release', () => {
    it.each([
      {
        tagInfo: makeTag({
          sha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
          date: new Date('2024-06-01T00:00:00Z'),
          message: 'Release notes',
          tag: 'v1.1.0',
        }),
        latestSha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
        source: 'the tag metadata ahead of the listing',
        publishedAt: new Date('2024-06-01T00:00:00Z'),
      },
      {
        latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
        source: 'the listing when the tag has no metadata',
        publishedAt: null,
        tagInfo: null,
      },
      {
        latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
        source: 'the listing when the network fails',
        tagInfo: new TypeError('fetch failed'),
        publishedAt: null,
      },
    ])(
      'takes the latest commit from $source',
      async ({ publishedAt, latestSha, tagInfo }) => {
        let client = makeClient({
          tags: [
            makeTag({
              sha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
              tag: 'v1.1.0',
            }),
            makeTag({ tag: 'v1.0.0' }),
          ],
          tagInfo: { 'v1.1.0': tagInfo },
        })
        let action = makeAction({ version: 'v1.0.0' })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: 'v1.1.0',
            hasUpdate: true,
            publishedAt,
            latestSha,
          }),
        ])
      },
    )

    it('reports a rate limit hit while reading the tag metadata', async () => {
      let client = makeClient({
        tags: [makeTag({ tag: 'v1.1.0' }), makeTag({ tag: 'v1.0.0' })],
        tagInfo: { 'v1.1.0': makeRateLimitError() },
      })
      let action = makeAction({ version: 'v1.0.0' })

      await expect(check(client, [action])).rejects.toMatchObject({
        name: 'GitHubRateLimitError',
      })
    })
  })

  describe('when the reference belongs to a tag family', () => {
    it.each([
      {
        tagInfo: makeTag({
          sha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
          date: new Date('2024-06-01T00:00:00Z'),
          message: 'Release notes',
          tag: 'actions-v0.1.2',
        }),
        latestSha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
        source: 'the tag metadata ahead of the listing',
        publishedAt: new Date('2024-06-01T00:00:00Z'),
      },
      {
        latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
        source: 'the listing when the tag has no metadata',
        publishedAt: null,
        tagInfo: null,
      },
      {
        latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
        source: 'the listing when the network fails',
        tagInfo: new TypeError('fetch failed'),
        publishedAt: null,
      },
    ])(
      'takes the latest commit from $source',
      async ({ publishedAt, latestSha, tagInfo }) => {
        let client = makeClient({
          references: [
            makeTag({
              sha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
              tag: 'actions-v0.1.2',
            }),
          ],
          tagInfo: { 'actions-v0.1.2': tagInfo },
        })
        let action = makeAction({
          name: 'owner/repo/deploy',
          version: 'actions-v0.1.1',
        })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: 'actions-v0.1.2',
            hasUpdate: true,
            publishedAt,
            latestSha,
          }),
        ])
      },
    )

    it('reports a rate limit hit while reading the tag metadata', async () => {
      let client = makeClient({
        tagInfo: { 'actions-v0.1.2': makeRateLimitError() },
        references: [makeTag({ tag: 'actions-v0.1.2' })],
      })
      let action = makeAction({
        name: 'owner/repo/deploy',
        version: 'actions-v0.1.1',
      })

      await expect(check(client, [action])).rejects.toMatchObject({
        name: 'GitHubRateLimitError',
      })
    })
  })

  describe('tag families', () => {
    it('resolves updates inside the prefixed tag family', async () => {
      let client = makeClient({
        references: [
          makeTag({ tag: 'actions-v0.1.0' }),
          makeTag({
            sha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
            tag: 'actions-v0.1.2',
          }),
          makeTag({ tag: 'actions-v0' }),
        ],
        latestRelease: makeRelease({ version: 'v9.0.0' }),
      })
      let action = makeAction({
        name: 'christopher-buss/bedrock/packages/actions/deploy',
        version: 'actions-v0.1.1',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '6e07ad1a3ad1fe82c33de2ab5a427e9a8d59b003',
          latestVersion: 'actions-v0.1.2',
          hasUpdate: true,
        }),
      ])
      expect(client.getMatchingTagReferences).toHaveBeenCalledExactlyOnceWith(
        'christopher-buss',
        'bedrock',
        'actions-',
      )
    })

    it('resolves each tag family of one repository from its own members', async () => {
      let client = makeClient({
        references: [
          makeTag({
            sha: 'b55d322140c858c13f460f44f4d1a034740953cb',
            tag: 'actions-v0.1.2',
          }),
          makeTag({
            sha: '0f298509e5acb1cb7161588de079829da577a355',
            tag: 'setup-v1.1.0',
          }),
        ],
      })
      let deploy = makeAction({
        name: 'owner/repo/deploy',
        version: 'actions-v0.1.1',
      })
      let setup = makeAction({
        name: 'owner/repo/setup',
        version: 'setup-v1.0.0',
      })

      let result = await check(client, [deploy, setup])

      expect(result).toEqual([
        expectedUpdate(deploy, {
          latestSha: 'b55d322140c858c13f460f44f4d1a034740953cb',
          latestVersion: 'actions-v0.1.2',
          hasUpdate: true,
        }),
        expectedUpdate(setup, {
          latestSha: '0f298509e5acb1cb7161588de079829da577a355',
          latestVersion: 'setup-v1.1.0',
          hasUpdate: true,
        }),
      ])
    })

    it.each([
      {
        outcome: 'an update to its commit',
        styleName: 'the default style',
        hasUpdate: true,
        options: {},
      },
      {
        options: { style: 'preserve' } as const,
        styleName: 'the preserve style',
        outcome: 'up to date',
        hasUpdate: false,
      },
    ])(
      'reports the newest family member already in use as $outcome with $styleName',
      async ({ hasUpdate, options }) => {
        let client = makeClient({
          references: [
            makeTag({
              sha: 'a42ef9f6b760bc65eb8f899b613e1212fc5cfd72',
              tag: 'actions-v0.1.1',
            }),
          ],
        })
        let action = makeAction({
          name: 'christopher-buss/bedrock/packages/actions/deploy',
          version: 'actions-v0.1.1',
        })

        let result = await check(client, [action], options)

        expect(result).toEqual([
          expectedUpdate(action, {
            latestSha: 'a42ef9f6b760bc65eb8f899b613e1212fc5cfd72',
            latestVersion: 'actions-v0.1.1',
            hasUpdate,
          }),
        ])
      },
    )

    it.each([
      {
        latestSha: 'd2cb86e7743926b54a5fa968710b58031ada504c',
        tagSha: 'd2cb86e7743926b54a5fa968710b58031ada504c',
        outcome: 'reports the commit it resolves to',
      },
      {
        outcome: 'reports no commit when none is found',
        latestSha: null,
        tagSha: null,
      },
    ])(
      'looks up the commit of an annotated family tag and $outcome',
      async ({ latestSha, tagSha }) => {
        let client = makeClient({
          references: [makeTag({ tag: 'actions-v0.1.2', sha: null })],
          tagShas: { 'actions-v0.1.2': tagSha },
        })
        let action = makeAction({
          name: 'owner/repo/deploy',
          version: 'actions-v0.1.1',
        })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestVersion: 'actions-v0.1.2',
            hasUpdate: true,
            latestSha,
          }),
        ])
      },
    )

    it('recovers the tag family of a SHA pin from its version comment', async () => {
      let client = makeClient({
        references: [
          makeTag({
            sha: 'c5500c31990360ec57059355f4603cf8992cf126',
            tag: 'actions-v0.1.1',
          }),
          makeTag({
            sha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
            tag: 'actions-v0.1.2',
          }),
        ],
        latestRelease: makeRelease({ version: 'v9.0.0' }),
      })
      let action = makeAction({
        version: 'c5500c31990360ec57059355f4603cf8992cf126',
        comment: inlineComment('actions-v0.1.1'),
        name: 'owner/repo/deploy',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
          latestVersion: 'actions-v0.1.2',
          currentRefType: 'sha',
          hasUpdate: true,
        }),
      ])
      expect(client.getMatchingTagReferences).toHaveBeenCalledExactlyOnceWith(
        'owner',
        'repo',
        'actions-',
      )
    })

    it('leaves a SHA pin on the latest release when its comment is prose', async () => {
      let release = makeRelease({ version: 'v7.0.0' })
      let client = makeClient({
        tagShas: { 'v7.0.0': 'e6a3f534941270958cbe9af190dca480acf82422' },
        references: [makeTag({ tag: 'actions-v0.1.2' })],
        latestRelease: release,
      })
      let action = makeAction({
        version: 'c1f6ec77fe2fb216a73b8d67b9349fc28c959f31',
        comment: inlineComment('pinned to actions-v0.1.1'),
        name: 'actions/checkout',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'e6a3f534941270958cbe9af190dca480acf82422',
          publishedAt: release.publishedAt,
          latestVersion: 'v7.0.0',
          currentRefType: 'sha',
          hasUpdate: true,
        }),
      ])
    })

    it('skips a family reference when the family has no published members', async () => {
      let client = makeClient({
        latestRelease: makeRelease({ version: 'v9.0.0' }),
        references: [makeTag({ tag: 'v9.0.0' })],
      })
      let action = makeAction({
        name: 'christopher-buss/bedrock/packages/actions/deploy',
        version: 'actions-v0.1.1',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          skipReason: 'tag-family',
          status: 'skipped',
        }),
      ])
    })
  })

  describe('comparison', () => {
    it.each([
      {
        latestSha: 'e6a3f534941270958cbe9af190dca480acf82422',
        pinned: 'e6a3f534941270958cbe9af190dca480acf82422',
        scenario: 'the same commit is up to date',
        hasUpdate: false,
      },
      {
        latestSha: 'e6a3f534941270958cbe9af190dca480acf82422',
        pinned: '4e9a3448c1b2946987d6dca7f4672e2db482a2be',
        scenario: 'another commit needs an update',
        hasUpdate: true,
      },
      {
        scenario: 'an unknown latest commit needs an update',
        pinned: '4e9a3448c1b2946987d6dca7f4672e2db482a2be',
        hasUpdate: true,
        latestSha: null,
      },
    ])(
      'compares a SHA pin with the commit of the latest release: $scenario',
      async ({ hasUpdate, latestSha, pinned }) => {
        let release = makeRelease({ version: 'v2.0.0' })
        let client = makeClient({
          tagShas: { 'v2.0.0': latestSha },
          latestRelease: release,
        })
        let action = makeAction({ version: pinned })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            latestVersion: 'v2.0.0',
            currentRefType: 'sha',
            hasUpdate,
            latestSha,
          }),
        ])
      },
    )

    it.each([
      {
        version: '9e48671c30ce53c99c5acf31261a2f73230149fc',
        reference: 'a SHA pin',
        currentRefType: 'sha',
      } as const,
      {
        reference: 'a version tag',
        currentRefType: 'tag',
        version: 'v1.0.0',
      } as const,
      {
        reference: 'a tag without a version',
        currentRefType: 'tag',
        version: 'stable',
      } as const,
    ])(
      'reports no latest version for $reference when the repository publishes neither releases nor tags',
      async ({ currentRefType, version }) => {
        let client = makeClient()
        let action = makeAction({ version })

        let result = await check(client, [action])

        expect(result).toEqual([expectedUpdate(action, { currentRefType })])
      },
    )

    it.each([
      {
        commit: 'b55d322140c858c13f460f44f4d1a034740953cb',
        outcome: 'an update to its commit',
        styleName: 'the default style',
        hasUpdate: true,
        options: {},
      },
      {
        commit: 'b55d322140c858c13f460f44f4d1a034740953cb',
        options: { style: 'semver' } as const,
        styleName: 'the semver style',
        outcome: 'an update',
        hasUpdate: true,
      },
      {
        commit: 'b55d322140c858c13f460f44f4d1a034740953cb',
        options: { style: 'preserve' } as const,
        styleName: 'the preserve style',
        outcome: 'up to date',
        hasUpdate: false,
      },
      {
        outcome: 'up to date when its commit is unknown',
        styleName: 'the default style',
        hasUpdate: false,
        commit: null,
        options: {},
      },
    ])(
      'reports an unchanged tag as $outcome with $styleName',
      async ({ hasUpdate, options, commit }) => {
        let release = makeRelease({ version: 'v1.0.0' })
        let client = makeClient({
          tagShas: { 'v1.0.0': commit },
          latestRelease: release,
        })
        let action = makeAction({ version: 'v1.0.0' })

        let result = await check(client, [action], options)

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            latestVersion: 'v1.0.0',
            latestSha: commit,
            hasUpdate,
          }),
        ])
      },
    )

    it.each([
      {
        commit: '0f298509e5acb1cb7161588de079829da577a355',
        options: { style: 'preserve' } as const,
        outcome: 'no update for a newer minor',
        styleName: 'the preserve style',
        isBreaking: false,
        hasUpdate: false,
        latest: 'v1.2.3',
      },
      {
        commit: '0f298509e5acb1cb7161588de079829da577a355',
        outcome: 'a breaking update for a newer major',
        options: { style: 'preserve' } as const,
        styleName: 'the preserve style',
        isBreaking: true,
        latest: 'v2.1.0',
        hasUpdate: true,
      },
      {
        styleName: 'the default style and no known commit',
        outcome: 'an update for a newer minor',
        isBreaking: false,
        latest: 'v1.2.3',
        hasUpdate: true,
        commit: null,
        options: {},
      },
    ])(
      'reports $outcome of a major-only tag with $styleName',
      async ({ isBreaking, hasUpdate, options, latest, commit }) => {
        let release = makeRelease({ version: latest })
        let client = makeClient({
          tagShas: { [latest]: commit },
          latestRelease: release,
        })
        let action = makeAction({ version: 'v1' })

        let result = await check(client, [action], options)

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            latestVersion: latest,
            latestSha: commit,
            isBreaking,
            hasUpdate,
          }),
        ])
      },
    )

    it.each([
      { scenario: 'another reference without a version', latest: 'latest' },
      { scenario: 'the same reference', latest: 'dev-build' },
    ])(
      'skips a reference without a version when the latest release names $scenario',
      async ({ latest }) => {
        let release = makeRelease({ version: latest })
        let client = makeClient({
          tags: [
            makeTag({
              sha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
              tag: latest,
            }),
          ],
          tagShas: { [latest]: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1' },
          latestRelease: release,
        })
        let action = makeAction({ version: 'dev-build' })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            latestSha: 'fc730bc4e3167d12a9fbc06b63469cf914c0dbb1',
            publishedAt: release.publishedAt,
            skipReason: 'not-comparable',
            latestVersion: latest,
            status: 'skipped',
          }),
        ])
      },
    )
  })

  describe('failures', () => {
    it('skips an action whose lookup fails and warns about it', async () => {
      let failure = new Error('GitHub API error: 500 Internal Server Error')
      let client = makeClient({ latestRelease: failure })
      let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let action = makeAction()

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          skipReason: 'check-failed',
          currentRefType: 'unknown',
          status: 'skipped',
        }),
      ])
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'Failed to check owner/repo:',
        failure,
      )
    })

    it('stops requesting further repositories after the first rate limit and rejects', async () => {
      let client = makeClientForRepos({
        'owner/first': { latestRelease: makeRelease({ version: 'v1.1.0' }) },
        'owner/third': { latestRelease: makeRelease({ version: 'v1.1.0' }) },
        'owner/second': { latestRelease: makeRateLimitError() },
      })
      let actions = [
        makeAction({ name: 'owner/first' }),
        makeAction({ name: 'owner/second' }),
        makeAction({ name: 'owner/third' }),
      ]

      await expect(check(client, actions)).rejects.toMatchObject({
        name: 'GitHubRateLimitError',
      })
      expect(client.getLatestRelease.mock.calls).toStrictEqual([
        ['owner', 'first'],
        ['owner', 'second'],
      ])
    })

    it.each([
      {
        token: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
        hint: 'Wait for reset or reduce request rate.',
        credentials: 'a token passed to the check',
        environment: '',
      },
      {
        environment: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
        hint: 'Wait for reset or reduce request rate.',
        credentials: 'a token in the environment',
        token: undefined,
      },
      {
        hint:
          'Please set GITHUB_TOKEN environment variable to increase the limit.\n' +
          'See: https://github.com/azat-io/actions-up?tab=readme-ov-file#github-token',
        credentials: 'no token',
        token: undefined,
        environment: '',
      },
    ])(
      'explains a rate limit with the hint for $credentials',
      async ({ environment, token, hint }) => {
        vi.stubEnv('GITHUB_TOKEN', environment)
        let rateLimitError = makeRateLimitError()
        let client = makeClient({ latestRelease: rateLimitError })

        await expect(
          checkUpdates([makeAction()], token, { client }),
        ).rejects.toMatchObject({
          message: `${rateLimitError.message}\n${hint}`,
          name: 'GitHubRateLimitError',
        })
      },
    )

    it.each<{ action: GitHubAction; lookup: string; repo: FakeRepo }>([
      {
        repo: { referenceTypes: { main: makeRateLimitError() } },
        action: makeAction({ version: 'main' }),
        lookup: 'the reference type lookup',
      },
      {
        repo: {
          latestRelease: makeRelease({ version: 'v1.1.0' }),
          tagShas: { 'v1.1.0': makeRateLimitError() },
        },
        lookup: 'the commit lookup of the latest release',
        action: makeAction({ version: 'v1.0.0' }),
      },
      {
        repo: {
          references: [makeTag({ tag: 'actions-v0.1.2', sha: null })],
          tagShas: { 'actions-v0.1.2': makeRateLimitError() },
        },
        action: makeAction({
          name: 'owner/repo/deploy',
          version: 'actions-v0.1.1',
        }),
        lookup: 'the commit lookup of an annotated tag',
      },
    ])(
      'reports a rate limit hit by $lookup instead of skipping the action',
      async ({ action, repo }) => {
        let client = makeClient(repo)

        await expect(check(client, [action])).rejects.toMatchObject({
          name: 'GitHubRateLimitError',
        })
      },
    )
  })

  describe('defensive branches unreachable through the public API', () => {
    it('reports an occurrence renamed during the check as having no latest version', async () => {
      let action = makeAction()
      let client = makeClient()
      client.getLatestRelease.mockImplementation(() => {
        action.name = 'owner/renamed'
        return Promise.resolve(makeRelease({ version: 'v2.0.0' }))
      })

      let result = await check(client, [action])

      expect(result).toEqual([expectedUpdate(action)])
    })

    it('prefers the highest version tag over a latest release with an empty tag name', async () => {
      let client = makeClient({
        tags: [
          makeTag({
            sha: '9b9ee15766ad430c233f049e6e298afe592fa843',
            tag: 'v0.2.0',
          }),
          makeTag({ tag: 'v0.1.0' }),
        ],
        latestRelease: makeRelease({ version: '' }),
      })
      let action = makeAction({ version: 'v0.1.0' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '9b9ee15766ad430c233f049e6e298afe592fa843',
          latestVersion: 'v0.2.0',
          hasUpdate: true,
        }),
      ])
    })

    it('keeps the release commit when a custom client fails the tag lookup of the latest release', async () => {
      let release = makeRelease({
        sha: 'b13402ff6d5bf94ee34523e6422149f92689a931',
        version: 'v5.1.0',
      })
      let client = makeClient({
        tagShas: { 'v5.1.0': new Error('Custom client failure') },
        latestRelease: release,
      })
      let action = makeAction({ version: 'v5.0.0' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: 'b13402ff6d5bf94ee34523e6422149f92689a931',
          publishedAt: release.publishedAt,
          latestVersion: 'v5.1.0',
          hasUpdate: true,
        }),
      ])
    })

    it('leaves the commit of an annotated family tag unknown when a custom client fails its tag lookup', async () => {
      let client = makeClient({
        tagShas: { 'actions-v0.1.2': new Error('Custom client failure') },
        references: [makeTag({ tag: 'actions-v0.1.2', sha: null })],
      })
      let action = makeAction({
        name: 'owner/repo/deploy',
        version: 'actions-v0.1.1',
      })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestVersion: 'actions-v0.1.2',
          hasUpdate: true,
        }),
      ])
    })

    it('falls back to a generic rate limit message when the client error carries none', async () => {
      let client = makeClient({
        latestRelease: Object.assign(makeRateLimitError(), { message: '' }),
      })

      await expect(check(client, [makeAction()])).rejects.toMatchObject({
        message:
          'GitHub API rate limit exceeded.\n' +
          'Please set GITHUB_TOKEN environment variable to increase the limit.\n' +
          'See: https://github.com/azat-io/actions-up?tab=readme-ov-file#github-token',
        name: 'GitHubRateLimitError',
      })
    })
  })

  describe('current behavior pending owner decision', () => {
    /**
     * Open question: should a release without a tag name be skipped instead?
     */
    it('reports a latest release with an empty tag name as checked without resolving its commit', async () => {
      let release = makeRelease({
        sha: '9e48671c30ce53c99c5acf31261a2f73230149fc',
        version: '',
      })
      let client = makeClient({ latestRelease: release })
      let action = makeAction({ version: 'v0.1.0' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '9e48671c30ce53c99c5acf31261a2f73230149fc',
          publishedAt: release.publishedAt,
          latestVersion: '',
        }),
      ])
      expect(client.getTagSha).not.toHaveBeenCalled()
    })

    /**
     * Open question: should the release list fallback skip prereleases too?
     */
    it('offers the newest prerelease when the repository has no latest release', async () => {
      let prerelease = makeRelease({
        sha: '8501747d7f1ab520c2a0d16fc9cad64c2336370f',
        version: 'v2.0.0-beta.1',
        isPrerelease: true,
      })
      let client = makeClient({
        tags: [
          makeTag({
            sha: '8501747d7f1ab520c2a0d16fc9cad64c2336370f',
            tag: 'v2.0.0-beta.1',
          }),
          makeTag({ tag: 'v1.0.0' }),
        ],
        releases: [prerelease],
      })
      let action = makeAction({ version: 'v1.0.0' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, {
          latestSha: '8501747d7f1ab520c2a0d16fc9cad64c2336370f',
          publishedAt: prerelease.publishedAt,
          latestVersion: 'v2.0.0-beta.1',
          isBreaking: true,
          hasUpdate: true,
        }),
      ])
    })

    /**
     * Open question: should missing and empty versions be reported alike?
     */
    it.each([
      {
        reported: 'the version as unknown',
        scenario: 'a missing version',
        currentVersion: 'unknown',
      },
      {
        reported: 'the empty version',
        scenario: 'an empty version',
        currentVersion: '',
        version: '',
      },
    ])(
      'skips a reference with $scenario as not comparable and reports $reported',
      async ({ currentVersion, version }) => {
        let release = makeRelease({ version: 'v1.0.0' })
        let client = makeClient({ latestRelease: release })
        let action = makeAction({ version })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, {
            publishedAt: release.publishedAt,
            skipReason: 'not-comparable',
            currentRefType: 'unknown',
            latestVersion: 'v1.0.0',
            status: 'skipped',
            currentVersion,
          }),
        ])
      },
    )

    /**
     * Open question: should a name without a repository be skipped instead?
     */
    it.each([
      { missing: 'an owner and repository pair', name: 'checkout' },
      { missing: 'a repository', name: 'owner/' },
    ])(
      'reports an action name without $missing as checked with no latest version',
      async ({ name }) => {
        let client = makeClient({
          latestRelease: makeRelease({ version: 'v2.0.0' }),
        })
        let action = makeAction({ version: 'v1', name })

        let result = await check(client, [action])

        expect(result).toEqual([
          expectedUpdate(action, { currentRefType: 'unknown' }),
        ])
      },
    )

    /**
     * Open question: should a calendar tag like 20240101 count as a SHA pin?
     */
    it('reports a calendar tag pin as a SHA reference', async () => {
      let client = makeClient()
      let action = makeAction({ name: 'acme/action', version: '20240101' })

      let result = await check(client, [action])

      expect(result).toEqual([
        expectedUpdate(action, { currentRefType: 'sha' }),
      ])
    })
  })
})
