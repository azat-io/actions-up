import type { ActionUpdate } from '../../types/action-update'
import type { GitHubClient } from '../../types/github-client'
import type { UpdateStyle } from '../../types/update-style'
import type { UpdateMode } from '../../types/update-mode'

import { buildFloatingTagCandidates } from '../versions/build-floating-tag-candidates'
import { buildSemverTagCandidates } from '../versions/build-semver-tag-candidates'
import { selectExistingTagReference } from './select-existing-tag-reference'
import { preserveTagFormat } from '../versions/preserve-tag-format'

interface ResolveTargetReferenceOptions {
  /**
   * GitHub client used to validate tag existence.
   */
  client: GitHubClient

  /**
   * Effective update style.
   */
  style: UpdateStyle

  /**
   * Update mode that defines the preferred `semver` granularity.
   */
  mode?: UpdateMode
}

/**
 * Resolve the final reference that should be written back to the workflow.
 *
 * Tag references are validated against the action repository, so a derived tag
 * is only written when it actually exists; otherwise the closest existing
 * floating tag or the exact latest version is used.
 *
 * @param update - Update entry enriched with lookup data.
 * @param options - Resolution options (style, client, mode).
 * @returns Update entry with resolved target reference fields.
 */
export async function resolveTargetReference(
  update: ActionUpdate,
  options: ResolveTargetReferenceOptions,
): Promise<ActionUpdate> {
  let { mode = 'major', client, style } = options

  if (!update.hasUpdate) {
    return { ...update, targetRefStyle: null, targetRef: null }
  }

  if (style === 'sha') {
    if (!update.latestSha) {
      return { ...update, targetRefStyle: null, targetRef: null }
    }

    return {
      ...update,
      targetRef: update.latestSha,
      targetRefStyle: 'sha',
    }
  }

  if (update.currentRefType === 'sha') {
    if (!update.latestSha) {
      return { ...update, targetRefStyle: null, targetRef: null }
    }

    return {
      ...update,
      targetRef: update.latestSha,
      targetRefStyle: 'sha',
    }
  }

  if (update.currentRefType !== 'tag' || !update.latestVersion) {
    return { ...update, targetRefStyle: null, targetRef: null }
  }

  if (style === 'semver') {
    /**
     * Rewrite the reference to the canonical floating tag for the selected
     * mode, falling back to the exact latest version when the canonical tag
     * does not exist.
     */
    let { rateLimited, reference } = await selectExistingTagReference(client, {
      candidates: buildSemverTagCandidates(update.latestVersion, mode),
      latestVersion: update.latestVersion,
      actionName: update.action.name,
      latestSha: update.latestSha,
    })

    return {
      ...update,
      targetRefRateLimited: rateLimited,
      targetRefStyle: 'tag',
      targetRef: reference,
    }
  }

  if (!update.currentVersion) {
    return { ...update, targetRefStyle: null, targetRef: null }
  }

  let preservedTarget = preserveTagFormat(
    update.currentVersion,
    update.latestVersion,
  )
  if (!preservedTarget) {
    return { ...update, targetRefStyle: null, targetRef: null }
  }

  if (preservedTarget === update.latestVersion) {
    return { ...update, targetRef: preservedTarget, targetRefStyle: 'tag' }
  }

  /**
   * A truncated tag (e.g. `v8` derived from `v8.3.2`) may not exist in the
   * action repository, so verify it before writing.
   */
  let { rateLimited, reference } = await selectExistingTagReference(client, {
    candidates: buildFloatingTagCandidates(
      update.currentVersion,
      update.latestVersion,
    ),
    latestVersion: update.latestVersion,
    actionName: update.action.name,
    latestSha: update.latestSha,
  })

  return {
    ...update,
    targetRefRateLimited: rateLimited,
    targetRefStyle: 'tag',
    targetRef: reference,
  }
}
