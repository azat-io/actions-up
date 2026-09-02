import type { GitHubClient } from '../../types/github-client'
import type { UpdateMode } from '../../types/update-mode'
import type { TagInfo } from '../../types/tag-info'

import { findCompatibleTag } from '../versions/find-compatible-tag'
import { getFamilyPrefix } from '../versions/get-family-prefix'

interface GetCompatibleUpdateParameters {
  /**
   * Optional in-memory cache for resolved tag SHAs.
   */
  shaCache?: Map<string, string | null>

  /**
   * Update mode that limits which tag can be selected.
   */
  mode: Exclude<UpdateMode, 'major'>

  /**
   * Optional in-memory cache for action tags.
   */
  tagsCache?: Map<string, TagInfo[]>

  /**
   * Current action version used as compatibility baseline.
   */
  currentVersion: string | null

  /**
   * Action name in `owner/repo` format (path suffix is allowed).
   */
  actionName: string
}

/**
 * Resolve the newest compatible update for an action.
 *
 * @param client - GitHub client instance.
 * @param parameters - Lookup parameters.
 * @returns Compatible target version and SHA, or null when none found.
 */
export async function getCompatibleUpdate(
  client: GitHubClient,
  parameters: GetCompatibleUpdateParameters,
): Promise<{ sha: string | null; version: string } | null> {
  let { currentVersion, actionName, mode } = parameters

  let familyPrefix = getFamilyPrefix(currentVersion)

  if (familyPrefix === null) {
    return null
  }

  let segments = actionName.split('/')
  if (segments.length < 2) {
    return null
  }
  let [owner, repo] = segments
  if (!owner || !repo) {
    return null
  }

  let tagsCache = parameters.tagsCache ?? new Map<string, TagInfo[]>()
  let shaCache = parameters.shaCache ?? new Map<string, string | null>()

  /**
   * A named family is fetched by its own prefix, because it can otherwise fall
   * outside the single page of tags the listing returns.
   */
  let tagsCacheKey = `${actionName}#${familyPrefix}`
  let tags = tagsCache.get(tagsCacheKey)
  if (!tags) {
    try {
      tags =
        familyPrefix === '' ?
          await client.getAllTags(owner, repo, 100)
        : await client.getMatchingTagReferences(owner, repo, familyPrefix)
    } catch {
      return null
    }
    tagsCache.set(tagsCacheKey, tags)
  }

  let compatibleTag = findCompatibleTag(tags, currentVersion, mode)
  if (!compatibleTag) {
    return null
  }

  let version = compatibleTag.tag
  let sha = compatibleTag.sha?.length ? compatibleTag.sha : null

  if (!sha) {
    let shaCacheKey = `${actionName}@${version}`
    if (shaCache.has(shaCacheKey)) {
      return { sha: shaCache.get(shaCacheKey) ?? null, version }
    }

    try {
      sha = await client.getTagSha(owner, repo, version)
    } catch {
      sha = null
    }
    shaCache.set(shaCacheKey, sha)
  }

  return { version, sha }
}
