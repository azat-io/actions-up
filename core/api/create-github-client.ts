import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubClient } from '../../types/github-client'

import { getMatchingTagReferences } from './get-matching-tag-references'
import { resolveGitHubTokenSync } from './resolve-github-token-sync'
import { getReferenceType } from './get-reference-type'
import { getLatestRelease } from './get-latest-release'
import { getAllReleases } from './get-all-releases'
import { getTagInfo } from './get-tag-info'
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
      tagInfo: new Map(),
      tagSha: new Map(),
    },
    rateLimitRemaining: resolved ? 5000 : 60,
    baseUrl: 'https://api.github.com',
    rateLimitReset: new Date(),
    token: resolved,
  }

  return {
    getMatchingTagReferences: (owner, repository, prefix) =>
      getMatchingTagReferences(context, { repo: repository, prefix, owner }),
    getRateLimitStatus: () => ({
      remaining: context.rateLimitRemaining,
      resetAt: context.rateLimitReset,
    }),
    getRefType: (owner, repository, reference) =>
      getReferenceType(context, { repo: repository, reference, owner }),
    getAllReleases: (owner, repository, limit) =>
      getAllReleases(context, { repo: repository, owner, limit }),
    getAllTags: (owner, repository, limit) =>
      getAllTags(context, { repo: repository, owner, limit }),
    getTagInfo: (owner, repository, tag) =>
      getTagInfo(context, { repo: repository, owner, tag }),
    shouldWaitForRateLimit: (threshold: number = 100) =>
      context.rateLimitRemaining < threshold,
    getTagSha: (owner, repository, tag) =>
      getTagSha(context, { repo: repository, owner, tag }),
    getLatestRelease: (owner, repository) =>
      getLatestRelease(context, owner, repository),
  }
}
