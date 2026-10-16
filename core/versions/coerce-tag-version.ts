import semver from 'semver'

import { parseTagFamily } from './parse-tag-family'

/**
 * Coerce the version a tag carries into plain `x.y.z` semver.
 *
 * The tag family prefix is skipped before coercion, because `semver.coerce`
 * takes the first run of digits it finds, and a family name can hold some:
 * alone it reads `web3-utils@1.2.3` as `3.0.0` and `node20-v1.2.3` as `20.0.0`.
 * A tag whose family cannot be determined is coerced whole.
 *
 * Examples:
 *
 * - `v1.2` -> `1.2.0`
 * - `web3-utils@1.2.3` -> `1.2.3`
 * - `ci@v1.0.0-rc.1` -> `1.0.0`
 * - `1.2.3.4` -> `1.2.3`
 * - `latest` -> null.
 *
 * @param tag - Tag name to read.
 * @returns Coerced version, or null when the tag holds no number.
 */
export function coerceTagVersion(tag: string): string | null {
  let family = parseTagFamily(tag)

  return semver.coerce(family?.core ?? tag)?.version ?? null
}
