import type { GitHubClient } from '../../types/github-client'
import type { UpdateMode } from '../../types/update-mode'
import type { TagInfo } from '../../types/tag-info'

import { findCompatibleTags } from '../versions/find-compatible-tags'
import { getFamilyPrefix } from '../versions/get-family-prefix'
import { resolveTagMeta } from './resolve-tag-meta'

/**
 * Outcome of a compatible update lookup.
 */
export type CompatibleUpdate =
  | {
      /**
       * Newest tag that satisfies both the update mode and the cool-down.
       */
      update: {
        /**
         * Publication date of the selected tag. Null when the cool-down did not
         * apply, or when the date could not be determined.
         */
        publishedAt: Date | null

        /**
         * Commit SHA the selected tag points to, null when unresolved.
         */
        sha: string | null

        /**
         * Selected tag name.
         */
        version: string
      }

      /**
       * No constraint held the lookup back.
       */
      reason: null
    }
  | {
      /**
       * Why no tag can be offered. `cool-down` means the mode allows one or
       * more tags but every one of them is too young. `no-candidate` means no
       * compatible tag was established: either the listing held nothing newer
       * that the mode allows, or the listing could not be read.
       */
      reason: 'no-candidate' | 'cool-down'

      /**
       * Nothing to offer.
       */
      update: null
    }

interface GetCompatibleUpdateParameters {
  /**
   * Current action version used as compatibility baseline.
   */
  currentVersion: string | null

  /**
   * Newest version the caller already vetted, usually the release the update
   * check settled on. The walk never rises above it, so a tag that was never
   * released cannot be offered. Omit it to consider every compatible tag.
   */
  latestVersion?: string | null

  /**
   * Action name in `owner/repo` format (path suffix is allowed).
   */
  actionName: string

  /**
   * Cool-down in milliseconds. A tag published less recently than this is
   * passed over. Zero, the default, disables the cool-down.
   */
  minAgeMs?: number

  /**
   * Update mode that limits which tag can be selected.
   */
  mode: UpdateMode

  /**
   * Clock used to measure the cool-down, in milliseconds since the epoch.
   * Defaults to the current time.
   */
  now?: number
}

/**
 * A candidate tag together with the metadata read while ranking it.
 */
interface SelectedCandidate {
  /**
   * Publication date and commit SHA, both null when they were not read.
   */
  meta: { sha: string | null; date: Date | null }

  /**
   * The candidate itself.
   */
  candidate: TagInfo
}

/**
 * Resolve the newest compatible update for an action.
 *
 * Both the update mode and the release age cool-down are applied here, so a tag
 * held back by either one steps down to the newest tag that clears both instead
 * of dropping the action.
 *
 * @param client - GitHub client instance.
 * @param parameters - Lookup parameters.
 * @returns The selected tag, or the reason no tag qualifies.
 * @throws GitHubRateLimitError - When a request the lookup needed, for the tag
 *   listing, a publication date or a commit SHA, was rate limited.
 */
export async function getCompatibleUpdate(
  client: GitHubClient,
  parameters: GetCompatibleUpdateParameters,
): Promise<CompatibleUpdate> {
  let { currentVersion, actionName, mode } = parameters
  let minAgeMs = parameters.minAgeMs ?? 0
  let now = parameters.now ?? Date.now()

  let familyPrefix = getFamilyPrefix(currentVersion)

  if (familyPrefix === null) {
    return { reason: 'no-candidate', update: null }
  }

  let segments = actionName.split('/')
  if (segments.length < 2) {
    return { reason: 'no-candidate', update: null }
  }
  let [owner, repository] = segments
  if (!owner || !repository) {
    return { reason: 'no-candidate', update: null }
  }

  /**
   * A named family is fetched by its own prefix, because it can otherwise fall
   * outside the single page of tags the listing returns.
   */
  let tags: TagInfo[]
  try {
    tags =
      familyPrefix === '' ?
        await client.getAllTags(owner, repository, 100)
      : await client.getMatchingTagReferences(owner, repository, familyPrefix)
  } catch (error) {
    /**
     * A rate limit says nothing about the tags, and reading it as an empty
     * listing would report the action as held back by the cool-down or the mode
     * when it was never checked.
     */
    if (isRateLimitError(error)) {
      throw error
    }
    return { reason: 'no-candidate', update: null }
  }

  let candidates = findCompatibleTags(tags, currentVersion, {
    latestVersion: parameters.latestVersion,
    mode,
  })
  if (candidates.length === 0) {
    return { reason: 'no-candidate', update: null }
  }

  let selected =
    minAgeMs > 0 ?
      await selectAgedCandidate(client, {
        repo: repository,
        candidates,
        minAgeMs,
        owner,
        now,
      })
    : { meta: { date: null, sha: null }, candidate: candidates[0]! }

  if (!selected) {
    return { reason: 'cool-down', update: null }
  }

  let version = selected.candidate.tag
  let sha =
    selected.candidate.sha?.length ? selected.candidate.sha : selected.meta.sha

  if (!sha) {
    try {
      sha = await client.getTagSha(owner, repository, version)
    } catch (error) {
      if (isRateLimitError(error)) {
        throw error
      }
      sha = null
    }
  }

  return {
    update: { publishedAt: selected.meta.date, version, sha },
    reason: null,
  }
}

/**
 * Take the newest candidate that clears the cool-down.
 *
 * Tag listings carry no dates, so every candidate costs one lookup. The lookups
 * are chained rather than run together, so a step-down of a single release does
 * not pay for the whole tag history. A date that cannot be determined counts as
 * old enough, which matches how an unknown publication date is treated
 * elsewhere. A rate limit is the exception: it is reported rather than read as
 * an unknown date, because it can hide the date of every candidate at once.
 *
 * @param client - GitHub client instance.
 * @param parameters - Candidates and the cool-down to apply.
 * @param parameters.candidates - Compatible tags ordered newest first.
 * @param parameters.minAgeMs - Cool-down in milliseconds.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.now - Clock used to measure the cool-down.
 * @returns The first old enough candidate, or null when none qualifies.
 * @throws GitHubRateLimitError - When a candidate lookup was rate limited.
 */
async function selectAgedCandidate(
  client: GitHubClient,
  parameters: {
    candidates: TagInfo[]
    minAgeMs: number
    owner: string
    repo: string
    now: number
  },
): Promise<SelectedCandidate | null> {
  let { candidates, minAgeMs, owner, repo, now } = parameters

  return candidates.reduce<Promise<SelectedCandidate | null>>(
    async (pending, candidate) => {
      let selected = await pending
      if (selected) {
        return selected
      }

      let meta = await resolveTagMeta(client, {
        tag: candidate.tag,
        owner,
        repo,
      })

      if (meta.date && now - meta.date.getTime() < minAgeMs) {
        return null
      }

      return { candidate, meta }
    },
    Promise.resolve(null),
  )
}

/**
 * Recognize the error the client reports a rate-limited request with.
 *
 * @param error - Error thrown by a lookup.
 * @returns True when the request was rate limited.
 */
function isRateLimitError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'GitHubRateLimitError'
}
