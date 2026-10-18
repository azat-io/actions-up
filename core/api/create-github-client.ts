import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubClient } from '../../types/github-client'

import { getMatchingTagReferences } from './get-matching-tag-references'
import { resolveGitHubTokenSync } from './resolve-github-token-sync'
import { createRequestLimiter } from './create-request-limiter'
import { getProtectedBranches } from './get-protected-branches'
import { getDefaultBranch } from './get-default-branch'
import { getReferenceType } from './get-reference-type'
import { getLatestRelease } from './get-latest-release'
import { getReleaseByTag } from './get-release-by-tag'
import { getBranchTipAt } from './get-branch-tip-at'
import { getAllReleases } from './get-all-releases'
import { compareCommits } from './compare-commits'
import { getAllTags } from './get-all-tags'
import { getTagSha } from './get-tag-sha'

/**
 * Create a functional GitHub API client with internal caches and rate-limit.
 *
 * @param token - Optional GitHub token override.
 * @returns Client with bound methods.
 */
export function createGitHubClient(token?: string): GitHubClient {
  let resolved =
    token ?? process.env['GITHUB_TOKEN'] ?? resolveGitHubTokenSync()

  let context: GitHubClientContext = {
    caches: {
      matchingReferences: new Map(),
      refType: new Map(),
    },
    rateLimitRemaining: resolved ? 5000 : 60,
    baseUrl: 'https://api.github.com',
    limiter: createRequestLimiter(),
    rateLimitReset: new Date(),
    responses: new Map(),
    token: resolved,
  }

  return {
    getMatchingTagReferences: (owner, repository, prefix) =>
      getMatchingTagReferences(context, { repo: repository, prefix, owner }),
    compareCommits: (owner, repository, { base, head }) =>
      compareCommits(context, { repo: repository, owner, base, head }),
    getBranchTipAt: (owner, repository, { branch, at }) =>
      getBranchTipAt(context, { repo: repository, branch, owner, at }),
    getRateLimitStatus: () => ({
      remaining: context.rateLimitRemaining,
      resetAt: context.rateLimitReset,
    }),
    getRefType: (owner, repository, reference) =>
      getReferenceType(context, { repo: repository, reference, owner }),
    getAllReleases: (owner, repository, limit) =>
      getAllReleases(context, { repo: repository, owner, limit }),
    getReleaseByTag: (owner, repository, tag) =>
      getReleaseByTag(context, { repo: repository, owner, tag }),
    getProtectedBranches: (owner, repository) =>
      getProtectedBranches(context, { repo: repository, owner }),
    getAllTags: (owner, repository, limit) =>
      getAllTags(context, { repo: repository, owner, limit }),
    getDefaultBranch: (owner, repository) =>
      getDefaultBranch(context, { repo: repository, owner }),
    shouldWaitForRateLimit: (threshold: number = 100) =>
      context.rateLimitRemaining < threshold,
    getTagSha: (owner, repository, tag) =>
      getTagSha(context, { repo: repository, owner, tag }),
    getLatestRelease: (owner, repository) =>
      getLatestRelease(context, owner, repository),
  }
}
