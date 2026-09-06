import type { GitHubClientContext } from '../../types/github-client-context'
import type { TagInfo } from '../../types/tag-info'

import { GitHubRateLimitError } from './internal-rate-limit-error'
import { makeRequest } from './make-request'

/**
 * Fetch tag information by tag name. Tries release-by-tag first to obtain
 * metadata (date/message), then resolves the commit SHA via refs. Falls back to
 * refs-only lookup when release-by-tag is not found.
 *
 * Every metadata request here is best effort, but a rate limit is reported
 * rather than absorbed, on every path. Absorbing it would answer with a tag
 * that carries no publication date, which the caller reads as a tag old enough
 * to offer.
 *
 * @param context - Client context.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name (may include 'refs/tags/' prefix).
 * @returns TagInfo object or null when tag cannot be found.
 * @throws GitHubRateLimitError - When a request was rate limited, so the caller
 *   reports the rate limit instead of reading the tag as undated.
 */
export async function getTagInfo(
  context: GitHubClientContext,
  parameters: { owner: string; repo: string; tag: string },
): Promise<TagInfo | null> {
  try {
    let { owner, repo, tag } = parameters
    let displayTag = tag.replace(/^refs\/tags\//u, '')
    let cacheKey = `${owner}/${repo}#${displayTag}`
    if (context.caches.tagInfo.has(cacheKey)) {
      return context.caches.tagInfo.get(cacheKey) ?? null
    }

    try {
      let releaseResp = await makeRequest(
        context,
        `/repos/${owner}/${repo}/releases/tags/${displayTag}`,
      )
      let releaseData = releaseResp.data as {
        target_commitish: string | null
        published_at: string | null
        body: string | null
      }
      let date: Date | null =
        releaseData.published_at ? new Date(releaseData.published_at) : null
      let message: string | null = releaseData.body ?? null
      let sha: string | null = null

      try {
        let referenceResp = await makeRequest(
          context,
          `/repos/${owner}/${repo}/git/ref/tags/${displayTag}`,
        )
        let referenceData = referenceResp.data as {
          object: { type: 'commit' | 'tag'; sha: string }
        }
        let { type: objectType, sha: objectSha } = referenceData.object

        if (objectSha && objectType === 'tag') {
          try {
            let tagResp = await makeRequest(
              context,
              `/repos/${owner}/${repo}/git/tags/${objectSha}`,
            )
            let tagData = tagResp.data as {
              tagger?: { date?: string | null }
              object: { sha?: string | null }
              message?: string | null
            }
            sha = tagData.object.sha ?? objectSha
            let taggerDate = tagData.tagger?.date
            if (!date && taggerDate) {
              date = new Date(taggerDate)
            }
            if (!message && typeof tagData.message === 'string') {
              ;({ message } = tagData)
            }
          } catch (tagObjectError: unknown) {
            if (isRateLimit(tagObjectError)) {
              throw tagObjectError
            }
            sha = objectSha
          }
        } else if (objectSha && objectType === 'commit') {
          sha = objectSha
          if (!date || !message) {
            try {
              let commitResp = await makeRequest(
                context,
                `/repos/${owner}/${repo}/git/commits/${objectSha}`,
              )
              let { message: commitMessage, author } = commitResp.data as {
                author?: { date?: string | null }
                message?: string | null
              }
              if (!message && typeof commitMessage === 'string') {
                message = commitMessage
              }
              let authorDate = author?.date
              if (!date && authorDate) {
                date = new Date(authorDate)
              }
            } catch (commitError: unknown) {
              if (isRateLimit(commitError)) {
                throw commitError
              }
            }
          }
        }
      } catch (referenceError: unknown) {
        if (isRateLimit(referenceError)) {
          throw referenceError
        }
        if (isLikelySha(releaseData.target_commitish)) {
          sha = releaseData.target_commitish
        }
      }

      let result: TagInfo = { tag: displayTag, message, date, sha }
      context.caches.tagInfo.set(cacheKey, result)
      return result
    } catch (releaseError: unknown) {
      /**
       * A rate limit reaches here from the release request itself or from any
       * of the metadata requests above. Retrying the refs fallback would spend
       * another request on the same exhausted budget.
       */
      if (isRateLimit(releaseError)) {
        throw releaseError
      }

      try {
        let referenceResp = await makeRequest(
          context,
          `/repos/${owner}/${repo}/git/ref/tags/${displayTag}`,
        )
        let referenceData = referenceResp.data as {
          object: { type: 'commit' | 'tag'; sha: string }
        }
        let { sha } = referenceData.object
        let message: string | null = null
        let date: Date | null = null

        if (referenceData.object.type === 'tag') {
          try {
            let tagResp = await makeRequest(
              context,
              `/repos/${owner}/${repo}/git/tags/${sha}`,
            )
            let tagData = tagResp.data as {
              tagger: { date?: string | null }
              object: { sha?: string | null }
              message?: string | null
            }
            sha = tagData.object.sha ?? sha
            message = tagData.message ?? null
            date = tagData.tagger.date ? new Date(tagData.tagger.date) : null
          } catch (tagObjectError: unknown) {
            if (isRateLimit(tagObjectError)) {
              throw tagObjectError
            }
          }
        } else {
          try {
            let commitResp = await makeRequest(
              context,
              `/repos/${owner}/${repo}/git/commits/${sha}`,
            )
            let commitData = commitResp.data as {
              author: { date?: string | null }
              message?: string | null
            }
            message = commitData.message ?? null
            date =
              commitData.author.date ? new Date(commitData.author.date) : null
          } catch (commitError: unknown) {
            if (isRateLimit(commitError)) {
              throw commitError
            }
          }
        }

        let result: TagInfo = { tag: displayTag, message, date, sha }
        context.caches.tagInfo.set(cacheKey, result)
        return result
      } catch (tagError: unknown) {
        /**
         * A rate limit arrives as a 403, so it has to be recognized before the
         * status check below turns every HTTP failure into "tag not found".
         * Otherwise the caller reads a rate-limited lookup as a tag without a
         * publication date.
         */
        if (isRateLimit(tagError)) {
          throw tagError
        }
        if (tagError && typeof tagError === 'object' && 'status' in tagError) {
          context.caches.tagInfo.set(cacheKey, null)
          return null
        }
        throw tagError
      }
    }
  } catch (error) {
    if (isRateLimit(error)) {
      throw new GitHubRateLimitError(context.rateLimitReset)
    }
    throw error
  }
}

function isLikelySha(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }
  let normalized = value.replace(/^v/u, '')
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}

/**
 * Recognize the rate limit that `makeRequest` reports as a rewritten message.
 *
 * @param error - Error thrown by a metadata request.
 * @returns True when the request was rate limited.
 */
function isRateLimit(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('rate limit')
}
