import type { UpdateMode } from '../types/update-mode'

/**
 * Normalizes the update mode option.
 *
 * @param mode - Raw mode option.
 * @returns Normalized update mode.
 */
export function normalizeUpdateMode(mode: undefined | string): UpdateMode {
  let normalized = (mode ?? 'major').toLowerCase()
  let modes: UpdateMode[] = ['major', 'minor', 'patch']
  if (modes.includes(normalized as UpdateMode)) {
    return normalized as UpdateMode
  }
  throw new Error(
    `Invalid mode "${mode}". Expected "major", "minor", or "patch".`,
  )
}
