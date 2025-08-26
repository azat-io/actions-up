import type {
  RateLimit,
  Release,
  Commit,
  Maybe,
  Tag,
} from '@octokit/graphql-schema'

import { GraphqlResponseError, graphql } from '@octokit/graphql'

/** GraphQL response shape for fetching all releases. */
interface AllReleasesResponse {
  /** Repository data containing releases. */
  repository: Maybe<{
    /** Releases connection with nodes. */
    releases: Maybe<{
      /** Array of release nodes. */
      nodes: (Pick<
        Release,
        | 'isPrerelease'
        | 'description'
        | 'publishedAt'
        | 'tagName'
        | 'name'
        | 'url'
      > & {
        /** Commit associated with the release tag. */
        tagCommit?: Maybe<Pick<Commit, 'oid'>>
      })[]
    }>
  }>

  /** Current rate limit information. */
  rateLimit: RateLimit
}

/** GraphQL response shape for fetching the latest release. */
interface LatestReleaseResponse {
  /** Repository data containing release information. */
  repository: Maybe<{
    /** Latest release information for the repository. */
    latestRelease: Maybe<
      Pick<
        Release,
        | 'isPrerelease'
        | 'description'
        | 'publishedAt'
        | 'tagName'
        | 'name'
        | 'url'
      > & {
        /** Commit associated with the release tag. */
        tagCommit?: Maybe<Pick<Commit, 'oid'>>
      }
    >
  }>

  /** Current rate limit information. */
  rateLimit: RateLimit
}

/** Processed release information with normalized types. */
interface ReleaseInfo {
  /** Release description or null if not provided. */
  description: string | null

  /** Whether this release is marked as a pre-release. */
  isPrerelease: boolean

  /** Git commit SHA for this release. */
  sha: string | null

  /** Date when the release was published. */
  publishedAt: Date

  /** Version tag name (e.g., 'v1.2.3'). */
  version: string

  /** Release name or tag name if name not provided. */
  name: string

  /** GitHub URL for this release. */
  url: string
}

/** GraphQL response shape for fetching tag information. */
interface TagInfoResponse {
  /** Repository data containing tag reference. */
  repository: Maybe<{
    /** Reference to the tag. */
    ref: Maybe<{
      /** Target object - either a Commit or Tag. */
      target: Commit | Tag
    }>
  }>

  /** Current rate limit information. */
  rateLimit: RateLimit
}

/** Processed tag information with normalized types. */
interface TagInfo {
  /** Tag or commit message, null if not provided. */
  message: string | null

  /** Date when the tag was created or committed. */
  date: Date | null

  /** Tag name (e.g., 'v1.2.3'). */
  tag: string

  /** Git commit SHA that this tag points to. */
  sha: string
}

/** Custom error for rate limit issues. */
class GitHubRateLimitError extends Error {
  /**
   * Creates a new GitHubRateLimitError.
   *
   * @param resetAt - The time when the rate limit resets.
   */
  public constructor(resetAt: Date) {
    let resetTime = resetAt.toLocaleTimeString()
    super(`GitHub API rate limit exceeded. Resets at ${resetTime}`)
    this.name = 'GitHubRateLimitError'
  }
}

/** GitHub GraphQL client with optional authentication. */
export class Client {
  private readonly graphqlWithAuth: typeof graphql
  private rateLimitRemaining: number = 5000
  private rateLimitReset: Date = new Date()

  /**
   * Creates a new GitHub API client.
   *
   * @param token - Optional GitHub token for authentication.
   */
  public constructor(token?: string) {
    let authToken = token ?? process.env['GITHUB_TOKEN']

    this.graphqlWithAuth = graphql.defaults({
      headers: authToken
        ? {
            authorization: `token ${authToken}`,
          }
        : {},
    })

    if (!authToken) {
      console.warn('No GitHub token found. API rate limits will be restricted.')
    }
  }

  private static isRateLimitError(error: unknown): boolean {
    if (error instanceof GraphqlResponseError) {
      return error.errors!.some(
        graphQLError =>
          graphQLError.type === 'RATE_LIMITED' ||
          (typeof graphQLError.message === 'string' &&
            /rate limit/iu.test(graphQLError.message)),
      )
    }
    if (error instanceof Error) {
      return /rate limit/iu.test(error.message)
    }
    return false
  }

  /**
   * Get specific tag/version information.
   *
   * @param owner - The repository owner.
   * @param repo - The repository name.
   * @param tag - The tag name to fetch.
   * @returns Tag information or null if not found.
   */
  public async getTagInfo(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<TagInfo | null> {
    try {
      let qualifiedTag = tag.startsWith('refs/tags/') ? tag : `refs/tags/${tag}`
      let displayTag = tag.replace(/^refs\/tags\//u, '')
      let query = /* GraphQL */ `
        query getTagInfo($owner: String!, $repo: String!, $tag: String!) {
          repository(owner: $owner, name: $repo) {
            ref(qualifiedName: $tag) {
              target {
                oid
                ... on Commit {
                  committedDate
                  message
                }
                ... on Tag {
                  tagger {
                    date
                  }
                  message
                  target {
                    oid
                  }
                }
              }
            }
          }
          rateLimit {
            remaining
            resetAt
          }
        }
      `

      let response = await this.graphqlWithAuth<TagInfoResponse>(query, {
        tag: qualifiedTag,
        owner,
        repo,
      })

      this.rateLimitRemaining = response.rateLimit.remaining
      this.rateLimitReset = new Date(response.rateLimit.resetAt as string)

      if (!response.repository?.ref?.target) {
        return null
      }

      let { target } = response.repository.ref

      if ('committedDate' in target) {
        return {
          date: target.committedDate
            ? new Date(target.committedDate as string)
            : null,
          message: target.message || null,
          sha: target.oid as string,
          tag: displayTag,
        }
      }
      let tagObject = target.target as { oid: string } | undefined | null
      return {
        date: target.tagger?.date
          ? new Date(target.tagger.date as string)
          : null,
        sha: tagObject?.oid ?? (target.oid as string),
        message: target.message ?? null,
        tag: displayTag,
      }
    } catch (error) {
      if (Client.isRateLimitError(error)) {
        throw new GitHubRateLimitError(this.rateLimitReset)
      }
      throw error
    }
  }

  /**
   * Get all releases for a repository.
   *
   * @param owner - The repository owner.
   * @param repo - The repository name.
   * @param limit - Maximum number of releases to fetch.
   * @returns Array of release information.
   */
  public async getAllReleases(
    owner: string,
    repo: string,
    limit: number = 10,
  ): Promise<ReleaseInfo[]> {
    try {
      let query = /* GraphQL */ `
        query getAllReleases($owner: String!, $repo: String!, $limit: Int!) {
          repository(owner: $owner, name: $repo) {
            releases(
              first: $limit
              orderBy: { field: CREATED_AT, direction: DESC }
            ) {
              nodes {
                tagName
                tagCommit {
                  oid
                }
                name
                description
                isPrerelease
                publishedAt
                url
              }
            }
          }
          rateLimit {
            remaining
            resetAt
          }
        }
      `

      let response = await this.graphqlWithAuth<AllReleasesResponse>(query, {
        owner,
        limit,
        repo,
      })

      this.rateLimitRemaining = response.rateLimit.remaining
      this.rateLimitReset = new Date(response.rateLimit.resetAt as string)

      if (!response.repository?.releases?.nodes) {
        return []
      }

      return response.repository.releases.nodes.map(release => ({
        sha: (release.tagCommit?.oid as undefined | string) ?? null,
        publishedAt: new Date(release.publishedAt as string),
        description: release.description ?? null,
        name: release.name ?? release.tagName,
        isPrerelease: release.isPrerelease,
        url: release.url as string,
        version: release.tagName,
      }))
    } catch (error) {
      if (Client.isRateLimitError(error)) {
        throw new GitHubRateLimitError(this.rateLimitReset)
      }
      throw error
    }
  }

  /**
   * Get the latest release for a GitHub repository.
   *
   * @param owner - The repository owner.
   * @param repo - The repository name.
   * @returns Latest release information or null if not found.
   */
  public async getLatestRelease(
    owner: string,
    repo: string,
  ): Promise<ReleaseInfo | null> {
    try {
      let query = /* GraphQL */ `
        query getLatestRelease($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            latestRelease {
              tagName
              tagCommit {
                oid
              }
              name
              description
              isPrerelease
              publishedAt
              url
            }
          }
          rateLimit {
            remaining
            resetAt
          }
        }
      `

      let response = await this.graphqlWithAuth<LatestReleaseResponse>(query, {
        owner,
        repo,
      })

      this.rateLimitRemaining = response.rateLimit.remaining
      this.rateLimitReset = new Date(response.rateLimit.resetAt as string)

      if (!response.repository?.latestRelease) {
        return null
      }

      let release = response.repository.latestRelease
      return {
        sha: (release.tagCommit?.oid as undefined | string) ?? null,
        publishedAt: new Date(release.publishedAt as string),
        description: release.description ?? null,
        name: release.name ?? release.tagName,
        isPrerelease: release.isPrerelease,
        url: release.url as string,
        version: release.tagName,
      }
    } catch (error) {
      if (Client.isRateLimitError(error)) {
        throw new GitHubRateLimitError(this.rateLimitReset)
      }
      throw error
    }
  }

  public getRateLimitStatus(): { remaining: number; resetAt: Date } {
    return {
      remaining: this.rateLimitRemaining,
      resetAt: this.rateLimitReset,
    }
  }

  /**
   * Check if we should wait before making more requests.
   *
   * @param threshold - Minimum remaining requests before waiting.
   * @returns True if rate limit is below threshold.
   */
  public shouldWaitForRateLimit(threshold: number = 100): boolean {
    return this.rateLimitRemaining < threshold
  }
}
