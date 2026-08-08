import type { ActionUpdate } from '../../types/action-update'
import type { GitHubClient } from '../../types/github-client'
import type { UpdateStyle } from '../../types/update-style'

import { selectExistingTagReference } from './select-existing-tag-reference'
import { preserveTagFormat } from '../versions/preserve-tag-format'

/**
 * Resolve the final reference that should be written back to the workflow.
 *
 * Tag references are validated against the action repository, so a preserved
 * tag is only written when it actually exists; otherwise the closest existing
 * floating tag or the exact latest version is used.
 *
 * @param update - Update entry enriched with lookup data.
 * @param style - Effective update style.
 * @param client - GitHub client used to validate tag existence.
 * @returns Update entry with resolved target reference fields.
 */
export async function resolveTargetReference(
  update: ActionUpdate,
  style: UpdateStyle,
  client: GitHubClient,
): Promise<ActionUpdate> {
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

  if (
    update.currentRefType === 'tag' &&
    update.currentVersion &&
    update.latestVersion
  ) {
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
      currentVersion: update.currentVersion,
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

  return { ...update, targetRefStyle: null, targetRef: null }
}
