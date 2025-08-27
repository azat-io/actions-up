import { Octokit } from '@octokit/rest'

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

/** GitHub REST API client with optional authentication. */
export class Client {
  private rateLimitReset: Date = new Date()
  private rateLimitRemaining: number = 60
  private readonly octokit: Octokit

  /**
   * Creates a new GitHub API client.
   *
   * @param token - Optional GitHub token for authentication.
   */
  public constructor(token?: string) {
    let authToken = token ?? process.env['GITHUB_TOKEN']

    this.octokit = new Octokit({
      auth: authToken ?? undefined,
    })

    if (!authToken) {
      console.warn('No GitHub token found. API rate limits will be restricted.')
    }

    this.rateLimitRemaining = authToken ? 5000 : 60
  }

  private static isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      let maybeAny = error as { message?: unknown; status?: unknown }
      let message =
        typeof maybeAny.message === 'string'
          ? maybeAny.message.toLowerCase()
          : ''
      let status =
        typeof maybeAny.status === 'number' ? maybeAny.status : undefined

      return (
        message.includes('rate limit') ||
        message.includes('api rate limit') ||
        status === 403
      )
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
      let displayTag = tag.replace(/^refs\/tags\//u, '')

      try {
        let { headers: releaseHeaders, data: releaseData } =
          await this.octokit.repos.getReleaseByTag({
            tag: displayTag,
            owner,
            repo,
          })

        this.updateRateLimitInfo(releaseHeaders)

        let sha: string | null = null
        if (releaseData.target_commitish) {
          try {
            let { data: commitData } = await this.octokit.repos.getCommit({
              ref: releaseData.target_commitish,
              owner,
              repo,
            })
            ;({ sha } = commitData)
          } catch {
            sha = releaseData.target_commitish
          }
        }

        return {
          date: releaseData.published_at
            ? new Date(releaseData.published_at)
            : null,
          sha: sha ?? releaseData.target_commitish,
          message: releaseData.body ?? null,
          tag: displayTag,
        }
      } catch (releaseError) {
        if (
          releaseError instanceof Error &&
          'status' in releaseError &&
          releaseError.status === 404
        ) {
          try {
            let { headers: referenceHeaders, data: referenceData } =
              await this.octokit.git.getRef({
                ref: `tags/${displayTag}`,
                owner,
                repo,
              })

            this.updateRateLimitInfo(referenceHeaders)

            let { sha } = referenceData.object
            let message: string | null = null
            let date: Date | null = null

            if (referenceData.object.type === 'tag') {
              try {
                let { data: tagData } = await this.octokit.git.getTag({
                  // eslint-disable-next-line camelcase
                  tag_sha: sha,
                  owner,
                  repo,
                })
                ;({ sha } = tagData.object)
                message = tagData.message || null
                date = tagData.tagger.date
                  ? new Date(tagData.tagger.date)
                  : null
              } catch {}
            } else if (referenceData.object.type === 'commit') {
              try {
                let { data: commitData } = await this.octokit.git.getCommit({
                  // eslint-disable-next-line camelcase
                  commit_sha: sha,
                  owner,
                  repo,
                })
                ;({ message } = commitData)
                date = commitData.author.date
                  ? new Date(commitData.author.date)
                  : null
              } catch {}
            }

            return {
              tag: displayTag,
              message,
              date,
              sha,
            }
          } catch (tagError) {
            if (
              tagError instanceof Error &&
              'status' in tagError &&
              tagError.status === 404
            ) {
              return null
            }
            throw tagError
          }
        }
        throw releaseError
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
      let { data: releases, headers } = await this.octokit.repos.listReleases({
        // eslint-disable-next-line camelcase
        per_page: limit,
        owner,
        repo,
      })

      this.updateRateLimitInfo(headers)

      let releaseInfos: ReleaseInfo[] = []

      await Promise.all(
        releases.map(async release => {
          let sha: string | null = null

          if (release.tag_name) {
            try {
              let tagInfo = await this.getTagInfo(owner, repo, release.tag_name)
              if (tagInfo) {
                ;({ sha } = tagInfo)
              }
            } catch {
              sha = release.target_commitish || null
            }
          }

          releaseInfos.push({
            publishedAt: new Date(release.published_at!),
            name: release.name ?? release.tag_name,
            description: release.body ?? null,
            isPrerelease: release.prerelease,
            version: release.tag_name,
            url: release.html_url,
            sha,
          })
        }),
      )

      return releaseInfos
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
      let { data: release, headers } =
        await this.octokit.repos.getLatestRelease({
          owner,
          repo,
        })

      this.updateRateLimitInfo(headers)

      let sha: string | null = null

      if (release.tag_name) {
        try {
          let tagInfo = await this.getTagInfo(owner, repo, release.tag_name)
          if (tagInfo) {
            ;({ sha } = tagInfo)
          }
        } catch {
          sha = release.target_commitish || null
        }
      }

      return {
        publishedAt: new Date(release.published_at!),
        name: release.name ?? release.tag_name,
        description: release.body ?? null,
        isPrerelease: release.prerelease,
        version: release.tag_name,
        url: release.html_url,
        sha,
      }
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return null
      }
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

  private updateRateLimitInfo(
    headers: Record<string, undefined | string | number>,
  ): void {
    let remaining = headers['x-ratelimit-remaining']
    if (remaining !== undefined) {
      this.rateLimitRemaining =
        typeof remaining === 'string'
          ? Number.parseInt(remaining, 10)
          : remaining
    }
    let reset = headers['x-ratelimit-reset']
    if (reset !== undefined) {
      let resetTime =
        typeof reset === 'string' ? Number.parseInt(reset, 10) : reset
      this.rateLimitReset = new Date(resetTime * 1000)
    }
  }
}
