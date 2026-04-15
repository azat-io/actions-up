import type { ActionUpdate } from '../../types/action-update'
import type { UpdateStyle } from '../../types/update-style'

/**
 * Resolve the final reference that should be written back to the workflow.
 *
 * @param update - Update entry enriched with lookup data.
 * @param style - Effective update style.
 * @returns Update entry with resolved target reference fields.
 */
export function resolveTargetReference(
  update: ActionUpdate,
  style: UpdateStyle,
): ActionUpdate {
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

  if (update.currentRefType === 'tag' && update.latestVersion) {
    return {
      ...update,
      targetRef: update.latestVersion,
      targetRefStyle: 'tag',
    }
  }

  return { ...update, targetRefStyle: null, targetRef: null }
}
