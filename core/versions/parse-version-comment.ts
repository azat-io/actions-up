import { parseTagFamily } from './parse-tag-family'

/**
 * Read the version a trailing comment records next to a pinned reference.
 *
 * A SHA pin carries no version of its own, so the comment written beside it is
 * the only record of which tag it came from — and, in a repository with several
 * tag families, of which family that tag belongs to.
 *
 * Only a comment that starts with a recognizable tag counts; anything else is
 * prose and is ignored. A leading `#` is tolerated so both raw comment text and
 * a full comment can be passed in.
 *
 * Examples:
 *
 * - `# v4.2.1` -> `v4.2.1`
 * - ` actions-v0.1.1` -> `actions-v0.1.1`
 * - `# pinned to v1.2.3` -> null
 * - `# renovate: pin` -> null.
 *
 * @param comment - Comment text, with or without its leading `#`.
 * @returns Recorded tag, or null when the comment records none.
 */
export function parseVersionComment(
  comment: undefined | string | null,
): string | null {
  if (!comment) {
    return null
  }

  let [token] = comment
    .replace(/^\s*#+/u, '')
    .trim()
    .split(/\s+/u, 1)

  if (!token || !parseTagFamily(token)) {
    return null
  }

  return token
}
