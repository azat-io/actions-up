import { parseTagFamily } from './parse-tag-family'

/**
 * Resolve the comparable family prefix of a tag reference.
 *
 * A single trailing `v` is dropped so that `v1.2.3` and `1.2.3` land in the
 * same family, and so that a publisher who starts writing `actions-v1.0.0`
 * after `actions-1.0.0` does not strand anyone. The empty string is the family
 * of ordinary semver tags; anything else is a named family such as `actions-`
 * or `@scope/pkg@`.
 *
 * Examples:
 *
 * - `v1.2.3` -> ``
 * - `1.2.3` -> ``
 * - `actions-v0.1.1` -> `actions-`
 * - `@scope/pkg@0.2.3` -> `@scope/pkg@`
 * - `nightly` -> null.
 *
 * @param tag - Tag reference to inspect.
 * @returns Family prefix, or null when the reference carries no version.
 */
export function getFamilyPrefix(tag: undefined | string | null): string | null {
  let family = parseTagFamily(tag)

  if (!family) {
    return null
  }

  return family.prefix.replace(/v$/iu, '')
}
