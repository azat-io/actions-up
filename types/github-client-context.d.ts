import type { TagInfo } from './tag-info'

/**
 * Internal client context shared by all API functions.
 *
 * Stores auth, rate-limit state, base URL and in-memory caches to decrease the
 * number of API requests during a single run.
 */
export interface GitHubClientContext {
  /** Lightweight caches keyed by owner/repo (+ extra payload). */
  caches: {
    /** Cache of reference type detections (branch/tag/null). */
    refType: Map<string, 'branch' | 'tag' | null>

    /** Cache of resolved tag metadata (message/date/SHA). */
    tagInfo: Map<string, TagInfo | null>

    /** Cache of resolved tag commit SHAs. */
    tagSha: Map<string, string | null>
  }

  /** Remaining requests available per current rate-limit window. */
  rateLimitRemaining: number

  /** GitHub token, if available. */
  token: undefined | string

  /** Scheduled time when rate limit resets. */
  rateLimitReset: Date

  /** GitHub REST API base URL. */
  baseUrl: string
}
