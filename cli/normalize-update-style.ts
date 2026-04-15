import type { UpdateStyle } from '../types/update-style'

/**
 * Normalizes the update style option.
 *
 * @param style - Raw style option.
 * @returns Normalized update style.
 */
export function normalizeUpdateStyle(style: undefined | string): UpdateStyle {
  let normalized = (style ?? 'sha').toLowerCase()
  if (normalized === 'preserve' || normalized === 'sha') {
    return normalized
  }

  throw new Error(`Invalid style "${style}". Expected "sha" or "preserve".`)
}
