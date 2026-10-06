/* eslint-disable camelcase */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import type {
  ReferencePayload,
  ReleasePayload,
  RouteAnswer,
} from '../../helpers/route-fetch'
import type { GitHubClient } from '../../../types/github-client'
import type { ReleaseInfo } from '../../../types/release-info'

import {
  makeReferencePayload,
  makeTagListingEntry,
  makeReleasePayload,
  rateLimitHeaders,
  routeFetch,
  ok,
} from '../../helpers/route-fetch'
import { createGitHubClient } from '../../../core/api/create-github-client'

vi.mock(import('node:child_process'), () => ({ execFileSync: vi.fn() }))
vi.mock(import('node:fs'), () => ({ readFileSync: vi.fn() }))

const COMMIT_SHA = '0c9cf1022529583a37d96f16ad80090459a3a1f5'

const TAG_REFERENCE_PATH = '/repos/actions/checkout/git/ref/tags/v4.2.2'

const RELEASE_NOTES = '## Changes\n* Fix checkout of annotated tags'

const RELEASE_URL = 'https://github.com/actions/checkout/releases/tag/v4.2.2'

/**
 * Release `v4.2.2` of `actions/checkout`, cut from a commit.
 *
 * @returns Fresh release payload.
 */
function makeRelease(): ReleasePayload {
  return makeReleasePayload({
    published_at: '2024-10-23T14:46:00Z',
    target_commitish: COMMIT_SHA,
    html_url: RELEASE_URL,
    body: RELEASE_NOTES,
    tag_name: 'v4.2.2',
    prerelease: false,
    name: 'v4.2.2',
  })
}

/**
 * Release `v4.2.2` as the client reports it after normalizing the payload.
 *
 * @returns Fresh release information.
 */
function makeReleaseInfo(): ReleaseInfo {
  return {
    publishedAt: new Date('2024-10-23T14:46:00Z'),
    description: RELEASE_NOTES,
    isPrerelease: false,
    version: 'v4.2.2',
    url: RELEASE_URL,
    sha: COMMIT_SHA,
    name: 'v4.2.2',
  }
}

/**
 * Lightweight tag `v4.2.2` pointing at the release commit.
 *
 * @returns Fresh reference payload.
 */
function makeTagReference(): ReferencePayload {
  return makeReferencePayload('refs/tags/v4.2.2', {
    sha: COMMIT_SHA,
    type: 'commit',
  })
}

describe('createGitHubClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('GITHUB_TOKEN', undefined)
    vi.stubEnv('GH_TOKEN', undefined)
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' })
    })
    vi.mocked(readFileSync).mockImplementation(path => {
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, open '${String(path)}'`),
        { code: 'ENOENT' },
      )
    })
  })

  afterEach(() => {
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    {
      description: 'the token it was created with over GITHUB_TOKEN',
      expected: 'Bearer explicit-token',
      githubToken: 'env-github-token',
      token: 'explicit-token',
      ghToken: undefined,
    },
    {
      description: 'GITHUB_TOKEN when it was created without a token',
      expected: 'Bearer env-github-token',
      githubToken: 'env-github-token',
      ghToken: 'env-gh-token',
      token: undefined,
    },
    {
      description: 'the token found by the resolver when GITHUB_TOKEN is unset',
      expected: 'Bearer env-gh-token',
      ghToken: 'env-gh-token',
      githubToken: undefined,
      token: undefined,
    },
  ])(
    'authenticates with $description',
    async ({ githubToken, expected, ghToken, token }) => {
      vi.stubEnv('GITHUB_TOKEN', githubToken)
      vi.stubEnv('GH_TOKEN', ghToken)
      let api = routeFetch({ [TAG_REFERENCE_PATH]: ok(makeTagReference()) })
      let client = createGitHubClient(token)

      await client.getTagSha('actions', 'checkout', 'v4.2.2')

      expect(api.headers).toStrictEqual([
        expect.objectContaining({ authorization: expected }),
      ])
    },
  )

  it('sends requests without credentials when no token can be found', async () => {
    let api = routeFetch({ [TAG_REFERENCE_PATH]: ok(makeTagReference()) })
    let client = createGitHubClient()

    await client.getTagSha('actions', 'checkout', 'v4.2.2')

    expect(api.headers[0]).not.toHaveProperty('authorization')
  })

  it.each<{
    call(client: GitHubClient): Promise<unknown>
    routes: Record<string, RouteAnswer>
    expected: unknown
    method: string
  }>([
    {
      call: (client: GitHubClient) =>
        client.getLatestRelease('actions', 'checkout'),
      routes: { '/repos/actions/checkout/releases/latest': ok(makeRelease()) },
      expected: makeReleaseInfo(),
      method: 'getLatestRelease',
    },
    {
      routes: {
        '/repos/actions/checkout/releases?per_page=5': ok([makeRelease()]),
      },
      call: (client: GitHubClient) =>
        client.getAllReleases('actions', 'checkout', 5),
      expected: [makeReleaseInfo()],
      method: 'getAllReleases',
    },
    {
      routes: {
        '/repos/actions/checkout/tags?per_page=50': ok([
          makeTagListingEntry('v4.2.2', COMMIT_SHA),
        ]),
      },
      call: (client: GitHubClient) =>
        client.getAllTags('actions', 'checkout', 50),
      expected: [{ sha: COMMIT_SHA, tag: 'v4.2.2', message: null, date: null }],
      method: 'getAllTags',
    },
    {
      routes: {
        '/repos/actions/checkout/git/matching-refs/tags/v4.2': ok([
          makeTagReference(),
        ]),
      },
      call: (client: GitHubClient) =>
        client.getMatchingTagReferences('actions', 'checkout', 'v4.2'),
      expected: [{ sha: COMMIT_SHA, tag: 'v4.2.2', message: null, date: null }],
      method: 'getMatchingTagReferences',
    },
    {
      routes: {
        '/repos/actions/checkout/git/ref/tags/v4': ok(
          makeReferencePayload('refs/tags/v4', {
            sha: COMMIT_SHA,
            type: 'commit',
          }),
        ),
      },
      call: (client: GitHubClient) =>
        client.getRefType('actions', 'checkout', 'v4'),
      method: 'getRefType',
      expected: 'tag',
    },
    {
      call: (client: GitHubClient) =>
        client.getTagSha('actions', 'checkout', 'v4.2.2'),
      routes: { [TAG_REFERENCE_PATH]: ok(makeTagReference()) },
      expected: COMMIT_SHA,
      method: 'getTagSha',
    },
    {
      expected: {
        date: new Date('2024-10-23T14:46:00Z'),
        message: RELEASE_NOTES,
        sha: COMMIT_SHA,
        tag: 'v4.2.2',
      },
      routes: {
        '/repos/actions/checkout/releases/tags/v4.2.2': ok(makeRelease()),
        [TAG_REFERENCE_PATH]: ok(makeTagReference()),
      },
      call: (client: GitHubClient) =>
        client.getTagInfo('actions', 'checkout', 'v4.2.2'),
      method: 'getTagInfo',
    },
  ])(
    'answers $method from the GitHub API',
    async ({ expected, routes, call }) => {
      routeFetch(routes)
      let client = createGitHubClient('explicit-token')

      let result = call(client)

      await expect(result).resolves.toStrictEqual(expected)
    },
  )

  it('answers a repeated lookup from its cache', async () => {
    let api = routeFetch({ [TAG_REFERENCE_PATH]: ok(makeTagReference()) })
    let client = createGitHubClient('explicit-token')

    let first = await client.getTagSha('actions', 'checkout', 'v4.2.2')
    let second = await client.getTagSha('actions', 'checkout', 'v4.2.2')

    expect([first, second]).toStrictEqual([COMMIT_SHA, COMMIT_SHA])
    expect(api.paths).toStrictEqual([TAG_REFERENCE_PATH])
  })

  it('reports the rate limit state of the latest response', async () => {
    routeFetch({
      [TAG_REFERENCE_PATH]: ok(
        makeTagReference(),
        rateLimitHeaders({
          resetAt: new Date('2026-10-03T14:37:21.000Z'),
          remaining: 4321,
        }),
      ),
    })
    let client = createGitHubClient('explicit-token')

    await client.getTagSha('actions', 'checkout', 'v4.2.2')

    expect(client.getRateLimitStatus()).toStrictEqual({
      resetAt: new Date('2026-10-03T14:37:21.000Z'),
      remaining: 4321,
    })
  })

  it.each([
    {
      description: 'an authenticated',
      token: 'explicit-token',
      expected: 5000,
    },
    { description: 'an anonymous', token: undefined, expected: 60 },
  ])(
    'starts with the hourly allowance of $description client',
    ({ expected, token }) => {
      let client = createGitHubClient(token)

      let { remaining } = client.getRateLimitStatus()

      expect(remaining).toBe(expected)
    },
  )

  it.each([
    {
      description:
        'asks to wait for a threshold just above the remaining requests',
      threshold: 100,
      expected: true,
    },
    {
      description:
        'does not ask to wait for a threshold equal to the remaining requests',
      expected: false,
      threshold: 99,
    },
  ])('$description', async ({ threshold, expected }) => {
    routeFetch({
      [TAG_REFERENCE_PATH]: ok(makeTagReference(), {
        'x-ratelimit-remaining': '99',
      }),
    })
    let client = createGitHubClient('explicit-token')
    await client.getTagSha('actions', 'checkout', 'v4.2.2')

    let shouldWait = client.shouldWaitForRateLimit(threshold)

    expect(shouldWait).toBe(expected)
  })
})

/* eslint-enable camelcase */
