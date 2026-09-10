import { KNOWN_RUNNER_IMAGES } from './known-runner-labels'
import { parseRunnerLabel } from './parse-runner-label'

/**
 * Resolves the newest generally available runner label for a `runs-on` value.
 *
 * Preview images are never offered, because they carry no SLA. Labels that are
 * already current, unknown, or newer than the newest stable image resolve to
 * null, so a workflow is never moved backwards.
 *
 * @example
 *
 * ```ts
 * getRunnerUpdate('ubuntu-22.04') // 'ubuntu-24.04'
 * getRunnerUpdate('ubuntu-24.04') // null
 * ```
 *
 * @param label - Raw `runs-on` value to check.
 * @returns Newer runner label, or null when there is nothing to update.
 */
export function getRunnerUpdate(label: string): string | null {
  let parsed = parseRunnerLabel(label)
  if (!parsed) {
    return null
  }

  let images = KNOWN_RUNNER_IMAGES[parsed.family]
  let currentIndex = images.findIndex(image => image.version === parsed.version)
  let latestStableIndex = images.findLastIndex(image => !image.preview)

  /**
   * Also covers a family without any stable image, where `findLastIndex`
   * returns -1 and every current index compares as newer.
   */
  if (currentIndex >= latestStableIndex) {
    return null
  }

  return `${parsed.family}-${images[latestStableIndex]!.version}`
}
