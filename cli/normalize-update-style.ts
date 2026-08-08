import type { UpdateStyle } from '../types/update-style'

/**
 * Normalizes the update style option.
 *
 * @param style - Raw style option.
 * @returns Normalized update style.
 */
export function normalizeUpdateStyle(style: undefined | string): UpdateStyle {
  let normalized = (style ?? 'sha').toLowerCase()
  let styles: UpdateStyle[] = ['preserve', 'semver', 'sha']
  if (styles.includes(normalized as UpdateStyle)) {
    return normalized as UpdateStyle
  }

  throw new Error(
    `Invalid style "${style}". Expected "sha", "preserve" or "semver".`,
  )
}
