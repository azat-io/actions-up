import type { GitHubClientContext } from '../../types/github-client-context'
import type { GitHubClient } from '../../types/github-client'

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
    getRateLimitStatus: () => ({
      remaining: context.rateLimitRemaining,
      resetAt: context.rateLimitReset,
    }),
    getRefType: (owner, repo, reference) =>
      getReferenceType(context, { reference, owner, repo }),
    shouldWaitForRateLimit: (threshold: number = 100) =>
      context.rateLimitRemaining < threshold,
    getAllReleases: (owner, repo, limit) =>
      getAllReleases(context, { owner, limit, repo }),
    getAllTags: (owner, repo, limit) =>
      getAllTags(context, { owner, limit, repo }),
    getTagInfo: (owner, repo, tag) => getTagInfo(context, { owner, repo, tag }),
    getLatestRelease: (owner, repo) => getLatestRelease(context, owner, repo),
    getTagSha: (owner, repo, tag) => getTagSha(context, { owner, repo, tag }),
  }
}
