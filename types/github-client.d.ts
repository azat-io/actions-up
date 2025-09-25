import type { ReleaseInfo } from './release-info'
import type { TagInfo } from './tag-info'

/**
 * Public API surface for interacting with GitHub from Actions Up.
 *
 * Methods are thin wrappers around lower-level functions bound to a client
 * context (auth + rate-limit + caches). All methods are async and return
 * normalized, serializable data structures.
 */
export interface GitHubClient {
  /** Detect whether a reference is a tag or a branch (or unknown). */
  getRefType(
    owner: string,
    repo: string,
    reference: string,
  ): Promise<'branch' | 'tag' | null>

  /** List releases with minimal enrichment. */
  getAllReleases(
    owner: string,
    repo: string,
    limit?: number,
  ): Promise<ReleaseInfo[]>

  /** Fetch tag metadata (message/date) and the resolved commit SHA. */
  getTagInfo(owner: string, repo: string, tag: string): Promise<TagInfo | null>

  /** Resolve commit SHA for a tag without fetching commit data. */
  getTagSha(owner: string, repo: string, tag: string): Promise<string | null>

  /** List repository tags (name + commit SHA). */
  getAllTags(owner: string, repo: string, limit?: number): Promise<TagInfo[]>

  /** Fetch the latest release or null when no latest release exists. */
  getLatestRelease(owner: string, repo: string): Promise<ReleaseInfo | null>

  /** Current rate limit snapshot. */
  getRateLimitStatus(): { remaining: number; resetAt: Date }

  /** True when remaining requests are below a threshold. */
  shouldWaitForRateLimit(threshold?: number): boolean
}
