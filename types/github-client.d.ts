import type { ComparisonStatus } from './comparison-status'
import type { BranchTipAt } from './branch-tip-at'
import type { ReleaseInfo } from './release-info'
import type { BranchHead } from './branch-head'
import type { TagInfo } from './tag-info'

/**
 * Public API surface for interacting with GitHub from Actions Up.
 *
 * Methods are thin wrappers around lower-level functions bound to a client
 * context (auth + rate-limit + caches). All methods are async and return
 * normalized, serializable data structures.
 */
export interface GitHubClient {
  /**
   * Compare a commit with a base, or null when the two share no history.
   */
  compareCommits(
    owner: string,
    repository: string,
    range: { base: string; head: string },
  ): Promise<ComparisonStatus | null>

  /**
   * Find the commit at the tip of a branch at a past moment, from the history
   * of the branch GitHub records; null when it cannot be established.
   */
  getBranchTipAt(
    owner: string,
    repository: string,
    moment: { branch: string; at: Date },
  ): Promise<BranchTipAt | null>

  /**
   * Detect whether a reference is a tag or a branch (or unknown).
   */
  getRefType(
    owner: string,
    repository: string,
    reference: string,
  ): Promise<'branch' | 'tag' | null>

  /**
   * List tag references whose name starts with the given prefix.
   */
  getMatchingTagReferences(
    owner: string,
    repository: string,
    prefix: string,
  ): Promise<TagInfo[]>

  /**
   * Fetch the published release of a tag, or null when it has none.
   */
  getReleaseByTag(
    owner: string,
    repository: string,
    tag: string,
  ): Promise<ReleaseInfo | null>

  /**
   * List releases with minimal enrichment.
   */
  getAllReleases(
    owner: string,
    repository: string,
    limit?: number,
  ): Promise<ReleaseInfo[]>

  /**
   * Resolve the commit a tag points at, or null when it points at no commit.
   */
  getTagSha(
    owner: string,
    repository: string,
    tag: string,
  ): Promise<string | null>

  /**
   * List repository tags (name + commit SHA).
   */
  getAllTags(
    owner: string,
    repository: string,
    limit?: number,
  ): Promise<TagInfo[]>

  /**
   * Fetch the latest release or null when no latest release exists.
   */
  getLatestRelease(
    owner: string,
    repository: string,
  ): Promise<ReleaseInfo | null>

  /**
   * List the protected branches with the commit at the tip of each.
   */
  getProtectedBranches(owner: string, repository: string): Promise<BranchHead[]>

  /**
   * Read the name of the default branch of a repository.
   */
  getDefaultBranch(owner: string, repository: string): Promise<string>

  /**
   * Current rate limit snapshot.
   */
  getRateLimitStatus(): { remaining: number; resetAt: Date }

  /**
   * True when remaining requests are below a threshold.
   */
  shouldWaitForRateLimit(threshold?: number): boolean
}
