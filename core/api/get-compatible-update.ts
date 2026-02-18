import type { GitHubClient } from '../../types/github-client'
import type { UpdateMode } from '../../types/update-mode'
import type { TagInfo } from '../../types/tag-info'

import { findCompatibleTag } from '../versions/find-compatible-tag'
import { isSemverLike } from '../versions/is-semver-like'

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

  if (!currentVersion || !isSemverLike(currentVersion)) {
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

  let tags = tagsCache.get(actionName)
  if (!tags) {
    try {
      tags = await client.getAllTags(owner, repo, 100)
    } catch {
      return null
    }
    tagsCache.set(actionName, tags)
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
