/* eslint-disable camelcase */

import { onTestFinished, vi } from 'vitest'

import type { GitHubReleasePayload } from '../../core/api/normalize-release'

/**
 * Origin of every request the GitHub client sends.
 */
const GITHUB_API_ORIGIN = 'https://api.github.com'

/**
 * Media type GitHub sends with every JSON body.
 */
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/**
 * How a stubbed route answers: with an HTTP response, or with a failure before
 * any response arrived.
 */
export type RouteAnswer =
  | {
      /**
       * Response headers, such as the `x-ratelimit-*` family.
       */
      headers: Record<string, string>

      /**
       * Reason phrase sent next to the status code.
       */
      statusText: string

      /**
       * HTTP status code.
       */
      status: number

      /**
       * Response body text.
       */
      body: string
    }
  | {
      /**
       * Marks a request that never got a response, like one sent while the
       * network is unreachable.
       */
      networkFailure: true
    }

/**
 * Update of a branch as the repository activity endpoint returns it.
 */
export interface BranchUpdatePayload {
  /**
   * Kind of update, such as `push`, `force_push` or `pr_merge`.
   */
  activity_type: string

  /**
   * Moment GitHub applied the update.
   */
  timestamp: string

  /**
   * Commit the branch moved from.
   */
  before: string

  /**
   * Commit the branch moved to.
   */
  after: string

  /**
   * Fully qualified name of the branch.
   */
  ref: string

  /**
   * Identifier of the update.
   */
  id: number
}

/**
 * Annotated tag object as the `git/tags` endpoint returns it.
 */
export interface TagObjectPayload {
  /**
   * Object the tag points at.
   */
  object: { sha: string | null; type: 'commit' }

  /**
   * Tag author and the moment the tag was created.
   */
  tagger: { date: string | null }

  /**
   * Tag message.
   */
  message: string | null

  /**
   * SHA of the tag object itself.
   */
  sha: string

  /**
   * Tag name.
   */
  tag: string
}

/**
 * Git reference as the `git/ref` and `git/matching-refs` endpoints return it.
 */
export interface ReferencePayload {
  /**
   * Object the reference points at: a commit for a lightweight tag or a branch,
   * a tag object for an annotated tag, and rarely a tree or a blob.
   */
  object: { type: 'commit' | 'tree' | 'blob' | 'tag'; sha: string }

  /**
   * Fully qualified reference name, such as `refs/tags/v4.2.2`.
   */
  ref: string
}

/**
 * Entry of the tags listing as the `tags` endpoint returns it.
 */
export interface TagListingEntryPayload {
  /**
   * Commit the tag points at.
   */
  commit: { sha: string; url: string }

  /**
   * Download URL of the tagged tree as a tarball.
   */
  tarball_url: string

  /**
   * Download URL of the tagged tree as a zip archive.
   */
  zipball_url: string

  /**
   * Tag name.
   */
  name: string
}

/**
 * Comparison as the compare endpoint returns it, trimmed to the fields that
 * tell how the head relates to the base.
 */
export interface ComparisonPayload {
  /**
   * Status of the head relative to the base.
   */
  status: 'identical' | 'diverged' | 'behind' | 'ahead'

  /**
   * Number of commits the base holds and the head lacks.
   */
  behind_by: number

  /**
   * Number of commits the head holds and the base lacks.
   */
  ahead_by: number
}

/**
 * Requests the stubbed `fetch` received, in the order they were sent.
 */
export interface FetchLog {
  /**
   * Request headers, with lowercased names.
   */
  headers: Record<string, string>[]

  /**
   * Path and query relative to the GitHub API origin, or the full URL of a
   * request sent anywhere else, without the fragment.
   */
  paths: string[]
}

/**
 * Branch as the branches endpoint returns it.
 */
export interface BranchPayload {
  /**
   * Commit at the tip of the branch.
   */
  commit: { sha: string; url: string }

  /**
   * Whether branch protection or a ruleset applies to the branch.
   */
  protected: boolean

  /**
   * Branch name.
   */
  name: string
}

/**
 * Release as the GitHub release endpoints return it.
 */
export interface ReleasePayload extends Omit<
  GitHubReleasePayload,
  'published_at'
> {
  /**
   * Publication timestamp in ISO 8601 format, null for a draft release.
   */
  published_at: string | null
}

/**
 * Replace `fetch` with a router that answers GitHub API paths from a table.
 *
 * Every call builds a fresh response, because a response body can be read only
 * once. A request that no route answers is rejected, and it also fails the
 * running test when the code under test swallows the rejection, so no test can
 * reach the real network. A route is picked by what the server would receive:
 * the fragment of a URL never leaves the client, so it is dropped first. Call
 * it inside a test and restore the spy with `vi.restoreAllMocks()` in
 * `afterEach`.
 *
 * @param routes - Answers keyed by path and query, such as
 *   `/repos/actions/checkout/releases/latest`.
 * @returns Log of the requests the stub received.
 */
export function routeFetch(routes: Record<string, RouteAnswer>): FetchLog {
  let log: FetchLog = { headers: [], paths: [] }
  let unexpected: string[] = []

  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    let url = toUrl(input).replace(/#.*/u, '')
    let path =
      url.startsWith(`${GITHUB_API_ORIGIN}/`) ?
        url.slice(GITHUB_API_ORIGIN.length)
      : url
    log.headers.push(Object.fromEntries(new Headers(init?.headers)))
    log.paths.push(path)

    let answer = Object.hasOwn(routes, path) ? routes[path] : undefined
    if (!answer) {
      unexpected.push(url)
      return Promise.reject(createUnexpectedRequestError([url]))
    }
    if ('networkFailure' in answer) {
      return Promise.reject(new TypeError('fetch failed'))
    }
    return Promise.resolve(
      new Response(answer.body, {
        statusText: answer.statusText,
        headers: answer.headers,
        status: answer.status,
      }),
    )
  })

  onTestFinished(() => {
    if (unexpected.length > 0) {
      throw createUnexpectedRequestError(unexpected)
    }
  })

  return log
}

/**
 * Response GitHub sends once the primary rate limit is exhausted.
 *
 * @param resetAt - Moment the limit resets, a whole second.
 * @param headers - Extra response headers, such as `retry-after`.
 * @returns Route answer with status 403 and the `x-ratelimit-*` headers.
 */
export function rateLimited(
  resetAt: Date = new Date('2026-10-03T15:00:00.000Z'),
  headers: Record<string, string> = {},
): RouteAnswer {
  let answer = errorAnswer(403, 'Forbidden', {
    message:
      "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)",
    documentation_url:
      'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting',
  })
  return {
    ...answer,
    headers: {
      ...answer.headers,
      ...rateLimitHeaders({ remaining: 0, resetAt }),
      'x-ratelimit-resource': 'core',
      'x-ratelimit-limit': '60',
      'x-ratelimit-used': '60',
      ...headers,
    },
  }
}

/**
 * Release payload of a tag of the `actions/checkout` repository.
 *
 * @param tag - Tag the release was published for.
 * @param publishedAt - Publication timestamp in ISO 8601 format.
 * @param options - Fields that differ from a mutable release cut from `main`.
 * @param options.immutable - Whether the release is immutable.
 * @param options.targetCommitish - Branch or commit the release names as its
 *   target.
 * @returns Fresh release payload.
 */
export function makeTagRelease(
  tag: string,
  publishedAt: string,
  options: { targetCommitish?: string; immutable?: boolean } = {},
): ReleasePayload {
  let { targetCommitish = 'main', immutable = false } = options
  return makeReleasePayload({
    html_url: `https://github.com/actions/checkout/releases/tag/${tag}`,
    target_commitish: targetCommitish,
    published_at: publishedAt,
    tag_name: tag,
    immutable,
    name: tag,
  })
}

/**
 * Release payload with realistic defaults.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh release payload.
 */
export function makeReleasePayload(
  overrides: Partial<ReleasePayload> = {},
): ReleasePayload {
  return {
    body: "## What's Changed\n* Check out the default branch of submodules",
    html_url: 'https://github.com/actions/checkout/releases/tag/v4.2.2',
    published_at: '2024-10-23T14:46:00Z',
    target_commitish: 'main',
    tag_name: 'v4.2.2',
    prerelease: false,
    immutable: false,
    name: 'v4.2.2',
    ...overrides,
  }
}

/**
 * Response GitHub sends with status 429 once a rate limit is exhausted.
 *
 * @param headers - Extra response headers, such as `retry-after`.
 * @returns Route answer with status 429.
 */
export function tooManyRequests(
  headers: Record<string, string> = {},
): RouteAnswer {
  let answer = errorAnswer(429, 'Too Many Requests', {
    message:
      'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
    documentation_url:
      'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api',
  })
  return { ...answer, headers: { ...answer.headers, ...headers } }
}

/**
 * Update of a branch of a repository.
 *
 * @param update - Fields of the update.
 * @param update.timestamp - Moment GitHub applied it, in ISO 8601 format.
 * @param update.before - Commit the branch moved from.
 * @param update.after - Commit the branch moved to.
 * @param update.activityType - Kind of update, `push` by default.
 * @param update.reference - Fully qualified name of the branch,
 *   `refs/heads/main` by default.
 * @returns Fresh branch update payload.
 */
export function makeBranchUpdate(update: {
  activityType?: string
  reference?: string
  timestamp: string
  before: string
  after: string
}): BranchUpdatePayload {
  let {
    reference = 'refs/heads/main',
    activityType = 'push',
    timestamp,
    before,
    after,
  } = update
  return {
    id: Date.parse(timestamp) / 1000,
    activity_type: activityType,
    ref: reference,
    timestamp,
    before,
    after,
  }
}

/**
 * Entry of the tags listing of the `actions/checkout` repository.
 *
 * @param name - Name the tag is listed under, such as `v4.2.2`.
 * @param sha - SHA of the commit the tag points at.
 * @returns Fresh listing entry.
 */
export function makeTagListingEntry(
  name: string,
  sha: string,
): TagListingEntryPayload {
  return {
    commit: {
      url: `https://api.github.com/repos/actions/checkout/commits/${sha}`,
      sha,
    },
    tarball_url: `https://api.github.com/repos/actions/checkout/tarball/refs/tags/${name}`,
    zipball_url: `https://api.github.com/repos/actions/checkout/zipball/refs/tags/${name}`,
    name,
  }
}

/**
 * Rate limit headers GitHub sends with a response. The reset moment travels as
 * whole seconds since the epoch.
 *
 * @param state - Rate limit fields to send; an omitted field sends no header.
 * @param state.remaining - Requests left in the current window.
 * @param state.resetAt - Moment the window resets, a whole second.
 * @returns Headers of the `x-ratelimit-*` family.
 */
export function rateLimitHeaders(state: {
  remaining?: number
  resetAt?: Date
}): Record<string, string> {
  let headers: Record<string, string> = {}
  if (state.remaining !== undefined) {
    headers['x-ratelimit-remaining'] = String(state.remaining)
  }
  if (state.resetAt) {
    headers['x-ratelimit-reset'] = String(state.resetAt.getTime() / 1000)
  }
  return headers
}

/**
 * Annotated tag object payload with realistic defaults.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh tag object payload.
 */
export function makeTagObjectPayload(
  overrides: Partial<TagObjectPayload> = {},
): TagObjectPayload {
  return {
    object: { sha: 'c37189c43ac432723883a0b74aa822bd5cb70b79', type: 'commit' },
    sha: '03770520e626d127797468a4f32109d5c096eb24',
    tagger: { date: '2024-10-23T14:40:00Z' },
    message: 'Release v4.2.2\n',
    tag: 'v4.2.2',
    ...overrides,
  }
}

/**
 * Page of branch updates, with a link to the next page when there is one.
 *
 * @param updates - Updates on the page, newest first.
 * @param nextCursor - Cursor of the next page, if any.
 * @returns Route answer with status 200.
 */
export function branchUpdatesPage(
  updates: BranchUpdatePayload[],
  nextCursor?: string,
): RouteAnswer {
  return ok(
    updates,
    nextCursor ?
      {
        link: `<${GITHUB_API_ORIGIN}/repositories/197814629/activity?direction=desc&per_page=100&after=${nextCursor}>; rel="next"`,
      }
    : {},
  )
}

/**
 * Comparison payload, with counts that follow the status.
 *
 * @param status - Status of the head relative to the base.
 * @returns Fresh comparison payload.
 */
export function makeComparisonPayload(
  status: ComparisonPayload['status'],
): ComparisonPayload {
  return {
    behind_by: status === 'behind' || status === 'diverged' ? 1 : 0,
    ahead_by: status === 'ahead' || status === 'diverged' ? 1 : 0,
    status,
  }
}

/**
 * Successful response with a JSON body.
 *
 * @param payload - Value sent as the JSON body.
 * @param headers - Extra response headers, such as the `x-ratelimit-*` family.
 * @returns Route answer with status 200.
 */
export function ok(
  payload: unknown,
  headers: Record<string, string> = {},
): RouteAnswer {
  return {
    headers: { 'content-type': JSON_CONTENT_TYPE, ...headers },
    body: JSON.stringify(payload),
    statusText: 'OK',
    status: 200,
  }
}

/**
 * Repository payload of `actions/checkout`, trimmed to the fields a lookup
 * reads.
 *
 * @param defaultBranch - Name of the default branch.
 * @returns Fresh repository payload.
 */
export function makeRepositoryPayload(defaultBranch: string): {
  default_branch: string
  full_name: string
  private: boolean
} {
  return {
    default_branch: defaultBranch,
    full_name: 'actions/checkout',
    private: false,
  }
}

/**
 * Branch payload of the `actions/checkout` repository.
 *
 * @param name - Name the branch is listed under, such as `releases/v4`.
 * @param sha - Commit at the tip of the branch.
 * @returns Fresh branch payload, protected.
 */
export function makeBranchPayload(name: string, sha: string): BranchPayload {
  return {
    commit: {
      url: `https://api.github.com/repos/actions/checkout/commits/${sha}`,
      sha,
    },
    protected: true,
    name,
  }
}

/**
 * Response GitHub sends when it refuses a request.
 *
 * @param message - Reason GitHub gives in the body.
 * @returns Route answer with status 403.
 */
export function forbidden(message: string): RouteAnswer {
  return errorAnswer(403, 'Forbidden', {
    documentation_url: 'https://docs.github.com/rest',
    message,
  })
}

/**
 * Response GitHub sends for a resource that does not exist.
 *
 * @returns Route answer with status 404.
 */
export function notFound(): RouteAnswer {
  return errorAnswer(404, 'Not Found', {
    documentation_url: 'https://docs.github.com/rest',
    message: 'Not Found',
  })
}

/**
 * Git reference payload.
 *
 * @param name - Fully qualified reference name, such as `refs/tags/v4.2.2`.
 * @param object - Object the reference points at.
 * @returns Fresh reference payload.
 */
export function makeReferencePayload(
  name: string,
  object: ReferencePayload['object'],
): ReferencePayload {
  return { object: { ...object }, ref: name }
}

/**
 * Response GitHub sends when it fails to handle a request.
 *
 * @returns Route answer with status 500.
 */
export function serverError(): RouteAnswer {
  return errorAnswer(500, 'Internal Server Error', { message: 'Server Error' })
}

/**
 * Failure of a request that never got a response.
 *
 * @returns Route answer that makes `fetch` reject the way it does offline.
 */
export function networkFailure(): RouteAnswer {
  return { networkFailure: true }
}

/**
 * Error response with a JSON body.
 *
 * @param status - HTTP status code.
 * @param statusText - Reason phrase sent next to the status code.
 * @param payload - Value sent as the JSON body.
 * @returns Route answer with the given status.
 */
function errorAnswer(
  status: number,
  statusText: string,
  payload: Record<string, string>,
): { headers: Record<string, string> } & RouteAnswer {
  return {
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: JSON.stringify(payload),
    statusText,
    status,
  }
}

/**
 * Full URL of a `fetch` input.
 *
 * @param input - URL string, URL object or request.
 * @returns URL as a string.
 */
function toUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) {
    return input.url
  }
  return input instanceof URL ? input.href : input
}

/**
 * Create the error the stubbed `fetch` rejects with when no route answers a
 * request.
 *
 * @param urls - URLs of the unanswered requests.
 * @returns Error naming the unanswered requests.
 */
function createUnexpectedRequestError(urls: string[]): Error {
  return new Error(`No stubbed route answers ${urls.join(', ')}`)
}

/* eslint-enable camelcase */
