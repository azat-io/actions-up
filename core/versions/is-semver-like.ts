/**
 * Check whether the value follows a semver-like tag pattern.
 *
 * Examples of accepted values: `v1`, `v1.2`, `1.2.3`.
 *
 * @param value - Raw value to validate.
 * @returns True when value looks like a semver-like tag.
 */
export function isSemverLike(value: undefined | string | null): boolean {
  return (
    typeof value === 'string' && /^v?\d+(?:\.\d+){0,2}$/u.test(value.trim())
  )
}
