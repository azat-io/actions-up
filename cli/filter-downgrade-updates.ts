import semver from 'semver'

import type { ActionUpdate } from '../types/action-update'

import { readInlineVersionComment } from '../core/versions/read-inline-version-comment'
import { normalizeVersion } from '../core/versions/normalize-version'
import { isSha } from '../core/versions/is-sha'

/**
 * Result of splitting updates into kept and downgrade-blocked groups.
 */
interface FilterDowngradeResult {
  /**
   * Updates that would downgrade a SHA-pinned action.
   */
  blocked: ActionUpdate[]

  /**
   * Updates that remain actionable.
   */
  kept: ActionUpdate[]
}

/**
 * Split updates into downgrades of SHA-pinned actions and the rest.
 *
 * SHA-pinned references are compared by SHA equality, which is blind to
 * direction: when the resolved latest version is older than the pin (e.g., a
 * repository whose latest release lags behind its tags), the difference is
 * reported as an update. The inline `# vX.Y.Z` comment next to the pin is used
 * as a best-effort current version to detect and block such downgrades.
 *
 * @param updates - Outdated updates to inspect.
 * @param fileCache - Optional cache of file contents by path.
 * @returns Updates split into blocked downgrades and kept updates.
 */
export async function filterDowngradeUpdates(
  updates: ActionUpdate[],
  fileCache?: Map<string, string>,
): Promise<FilterDowngradeResult> {
  let verdicts = await Promise.all(
    updates.map(async update => ({
      downgrade: await isDowngrade(update, fileCache),
      update,
    })),
  )

  let blocked: ActionUpdate[] = []
  let kept: ActionUpdate[] = []

  for (let { downgrade, update } of verdicts) {
    if (downgrade) {
      blocked.push(update)
    } else {
      kept.push(update)
    }
  }

  return { blocked, kept }
}

/**
 * Check whether an update would downgrade a SHA-pinned action.
 *
 * @param update - Update to inspect.
 * @param fileCache - Optional cache of file contents by path.
 * @returns True when the inline comment version is higher than the latest one.
 */
async function isDowngrade(
  update: ActionUpdate,
  fileCache?: Map<string, string>,
): Promise<boolean> {
  if (!isSha(update.currentVersion)) {
    return false
  }

  /**
   * Floating versions (v12, v12.1) resolve to moving tags whose SHA can be
   * ahead of the pin, so only fully specified versions are comparable.
   */
  let latest = update.latestVersion
  if (!latest || !/^v?\d+\.\d+\.\d+/u.test(latest.trim())) {
    return false
  }

  /**
   * Coercion always succeeds for a fully specified version.
   */
  let latestNormalized = semver.valid(normalizeVersion(latest))!

  let inline = await readInlineVersionComment(
    update.action.file,
    update.action.line,
    fileCache,
  )

  /**
   * Require a dotted version so date- or ticket-like comments (e.g. "#
   * 2024-05-01") cannot masquerade as version claims.
   */
  let inlineNormalized =
    inline?.includes('.') ? semver.valid(normalizeVersion(inline)) : null

  return Boolean(
    inlineNormalized && semver.gt(inlineNormalized, latestNormalized),
  )
}
