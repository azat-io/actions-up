import type { components } from '@octokit/openapi-types'

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

  /** Git commit SHA that this tag points to. */
  sha: string | null

  /** Date when the tag was created or committed. */
  date: Date | null

  /** Tag name (e.g., 'v1.2.3'). */
  tag: string
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
  private readonly baseUrl = 'https://api.github.com'
  private readonly token: undefined | string
  private rateLimitReset: Date = new Date()
  private rateLimitRemaining: number = 60

  /**
   * Creates a new GitHub API client.
   *
   * @param token - Optional GitHub token for authentication.
   */
  public constructor(token?: string) {
    this.token =
      token ?? process.env['GITHUB_TOKEN'] ?? resolveGitHubTokenSync()
    this.rateLimitRemaining = this.token ? 5000 : 60
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
        let releaseResp = await this.makeRequest(
          `/repos/${owner}/${repo}/releases/tags/${displayTag}`,
        )
        let releaseData = releaseResp.data as components['schemas']['release']
        let date: Date | null = releaseData.published_at
          ? new Date(releaseData.published_at)
          : null
        let message: string | null = releaseData.body ?? null
        let sha: string | null = null

        /**
         * Resolve commit SHA strictly from the tag reference to avoid
         * accidentally using a moving branch from target_commitish.
         */
        try {
          let referenceResp = await this.makeRequest(
            `/repos/${owner}/${repo}/git/refs/tags/${displayTag}`,
          )
          let referenceData =
            referenceResp.data as components['schemas']['git-ref']

          let objectSha = referenceData.object.sha
          let objectType = referenceData.object.type

          if (objectSha && objectType === 'tag') {
            try {
              let tagResp = await this.makeRequest(
                `/repos/${owner}/${repo}/git/tags/${objectSha}`,
              )
              let tagData = tagResp.data as components['schemas']['git-tag']

              let tagObject = (
                tagData as {
                  object?: { sha?: string | null }
                }
              ).object
              sha = tagObject?.sha ?? null

              /* Fill missing metadata from annotated tag if release lacks it. */
              let taggerDate = (
                tagData as {
                  tagger?: { date?: string | null }
                }
              ).tagger?.date
              if (!date && taggerDate) {
                date = new Date(taggerDate)
              }
              let tagMessage = (tagData as { message?: string | null }).message
              if (!message && typeof tagMessage === 'string') {
                message = tagMessage
              }
            } catch {
              /** Fall back to ref sha if tag details can't be fetched. */
              sha = objectSha
            }
          } else if (objectSha && objectType === 'commit') {
            sha = objectSha
            /* Optionally enrich from commit if release lacks metadata. */
            if (!date || !message) {
              try {
                let commitResp = await this.makeRequest(
                  `/repos/${owner}/${repo}/git/commits/${objectSha}`,
                )
                let commitData =
                  commitResp.data as components['schemas']['git-commit']

                let { message: commitMessage } = commitData as {
                  message?: string | null
                }
                if (!message && typeof commitMessage === 'string') {
                  message = commitMessage
                }
                let authorDate = (
                  commitData as {
                    author?: { date?: string | null }
                  }
                ).author?.date
                if (!date && authorDate) {
                  date = new Date(authorDate)
                }
              } catch {
                /** Keep current nulls if commit details can't be fetched. */
              }
            }
          } else {
            /* Invalid or unexpected ref format; leave sha as null */
          }
        } catch {
          /**
           * If ref lookup fails, only use target_commitish when it looks like a
           * SHA. Do NOT use branch names (moving targets).
           */
          if (isLikelySha(releaseData.target_commitish)) {
            sha = releaseData.target_commitish
          }
        }

        return { tag: displayTag, message, date, sha }
      } catch (releaseError: unknown) {
        if (
          releaseError &&
          typeof releaseError === 'object' &&
          'status' in releaseError &&
          releaseError.status === 404
        ) {
          try {
            let referenceResp = await this.makeRequest(
              `/repos/${owner}/${repo}/git/refs/tags/${displayTag}`,
            )
            let referenceData =
              referenceResp.data as components['schemas']['git-ref']

            let { sha } = referenceData.object
            let message: string | null = null
            let date: Date | null = null

            if (referenceData.object.type === 'tag') {
              try {
                let tagResp = await this.makeRequest(
                  `/repos/${owner}/${repo}/git/tags/${sha}`,
                )
                let tagData = tagResp.data as components['schemas']['git-tag']
                ;({ sha } = tagData.object)
                ;({ message } = tagData)
                date = tagData.tagger.date
                  ? new Date(tagData.tagger.date)
                  : null
              } catch {
                /** Fall back to ref sha if tag details can't be fetched. */
              }
            } else {
              try {
                let commitResp = await this.makeRequest(
                  `/repos/${owner}/${repo}/git/commits/${sha}`,
                )
                let commitData =
                  commitResp.data as components['schemas']['git-commit']
                ;({ message } = commitData)
                date = commitData.author.date
                  ? new Date(commitData.author.date)
                  : null
              } catch {
                /** Keep null values if commit details can't be fetched. */
              }
            }

            return {
              tag: displayTag,
              message,
              date,
              sha,
            }
          } catch (tagError: unknown) {
            if (
              tagError &&
              typeof tagError === 'object' &&
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
      let releasesResp = await this.makeRequest(
        `/repos/${owner}/${repo}/releases?per_page=${limit}`,
      )
      let releases = releasesResp.data as components['schemas']['release'][]

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
              /* Only keep SHA if target_commitish actually looks like SHA. */
              sha = isLikelySha(release.target_commitish)
                ? release.target_commitish
                : null
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
      let releaseResp = await this.makeRequest(
        `/repos/${owner}/${repo}/releases/latest`,
      )
      let release = releaseResp.data as components['schemas']['release']

      let sha: string | null = null

      if (release.tag_name) {
        try {
          let tagInfo = await this.getTagInfo(owner, repo, release.tag_name)
          if (tagInfo) {
            ;({ sha } = tagInfo)
          }
        } catch {
          sha = isLikelySha(release.target_commitish)
            ? release.target_commitish
            : null
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
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 404
      ) {
        return null
      }
      if (Client.isRateLimitError(error)) {
        throw new GitHubRateLimitError(this.rateLimitReset)
      }
      throw error
    }
  }

  public async getAllTags(
    owner: string,
    repo: string,
    limit: number = 30,
  ): Promise<TagInfo[]> {
    try {
      let tagsResp = await this.makeRequest(
        `/repos/${owner}/${repo}/tags?per_page=${limit}`,
      )
      let tags = tagsResp.data as {
        commit: { sha: string; url: string }
        zipball_url: string
        tarball_url: string
        node_id: string
        name: string
      }[]

      return tags.map(tag => ({
        sha: tag.commit.sha,
        tag: tag.name,
        message: null,
        date: null,
      }))
    } catch (error) {
      if (Client.isRateLimitError(error)) {
        throw new GitHubRateLimitError(this.rateLimitReset)
      }
      throw error
    }
  }

  public async getRefType(
    owner: string,
    repo: string,
    reference: string,
  ): Promise<'branch' | 'tag' | null> {
    try {
      await this.makeRequest(
        `/repos/${owner}/${repo}/git/refs/tags/${reference}`,
      )
      return 'tag'
    } catch {
      try {
        await this.makeRequest(
          `/repos/${owner}/${repo}/git/refs/heads/${reference}`,
        )
        return 'branch'
      } catch {
        return null
      }
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

  private async makeRequest(
    path: string,
    options: RequestInit = {},
  ): Promise<{ headers: Record<string, string>; data: unknown }> {
    let headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'actions-up',
      ...(options.headers as Record<string, string>),
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    interface FetchResponseLike {
      headers: { entries(): IterableIterator<[string, string]> }
      json(): Promise<unknown>
      text(): Promise<string>
      statusText: string
      status: number
      ok: boolean
    }

    let response = (await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    })) as unknown as FetchResponseLike

    let responseHeaders: Record<string, string> = {}
    for (let [key, value] of response.headers.entries()) {
      responseHeaders[key] = value
    }

    this.updateRateLimitInfo(responseHeaders)

    if (!response.ok) {
      let error = new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      ) as { status?: number } & Error
      error.status = response.status

      if (response.status === 403) {
        let text = await response.text()
        if (text.includes('rate limit') || text.includes('API rate limit')) {
          error.message = 'API rate limit exceeded'
        }
      }

      throw error
    }

    let data = await response.json()
    return { headers: responseHeaders, data }
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

/**
 * Resolve GitHub token from multiple sources with descending priority.
 *
 * Priority:
 *
 * 1. Env GITHUB_TOKEN
 * 2. Env GH_TOKEN
 * 3. Gh auth token
 * 4. .git/config keys (github.token, github.oauth-token, hub.oauthtoken).
 *
 * This is a synchronous best-effort resolver without throwing on failures.
 *
 * @returns Token string or undefined when not found.
 */
export function resolveGitHubTokenSync(): undefined | string {
  let fromGithubToken = process.env['GITHUB_TOKEN']
  if (fromGithubToken && fromGithubToken.trim() !== '') {
    return fromGithubToken.trim()
  }

  let fromGhToken = process.env['GH_TOKEN']
  if (fromGhToken && fromGhToken.trim() !== '') {
    return fromGhToken.trim()
  }

  try {
    let output = execFileSync('gh', ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    })
    let token = output.trim()
    if (token) {
      return token
    }
  } catch {
    /** Ignore gh resolution errors. */
  }

  try {
    let gitConfigPath = join(process.cwd(), '.git', 'config')
    let content = readFileSync(gitConfigPath, 'utf8')
    let directMatch = content.match(
      /^\s*(?:github\.(?:oauth-token|token)|hub\.oauthtoken)\s*=\s*(?<token>\S[^\n\r]*)$/mu,
    )
    let directToken = directMatch?.groups?.['token']?.trim()
    if (directToken) {
      return directToken
    }

    let currentSection: string | null = null
    for (let rawLine of content.split(/\r?\n/u)) {
      let line = rawLine.trim()
      let sectionMatch = line.match(/^\[(?<name>[^\]]+)\]$/u)
      if (sectionMatch?.groups) {
        currentSection = sectionMatch.groups['name']!.toLowerCase()
        continue
      }

      if (currentSection === 'github') {
        let tokenMatch = line.match(
          /^(?:oauth-token|token)\s*=\s*(?<val>\S[^\n\r]*)$/u,
        )
        if (tokenMatch?.groups?.['val']) {
          return tokenMatch.groups['val'].trim()
        }
      }
      if (currentSection === 'hub') {
        let oauthMatch = line.match(/^oauthtoken\s*=\s*(?<val>\S[^\n\r]*)$/u)
        if (oauthMatch?.groups?.['val']) {
          return oauthMatch.groups['val'].trim()
        }
      }
    }
  } catch {
    /** Ignore git config resolution errors. */
  }

  return undefined
}

/**
 * Lightweight SHA detector (7-40 hex chars, optional leading 'v' already
 * handled by callers).
 *
 * @param value - Value to check for SHA-like format.
 * @returns True when the value matches a Git SHA pattern.
 */
function isLikelySha(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  let normalized = value.replace(/^v/u, '')
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}
