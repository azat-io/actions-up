import type { TagInfo } from '../../types/tag-info'

/**
 * Build a tag entry shaped like the ones the GitHub API layer returns.
 *
 * Every entry points at the same commit unless an override says otherwise, so
 * tests that tell tags apart by name do not depend on the SHA.
 *
 * @param tag - Tag name.
 * @param overrides - Fields that differ from the defaults.
 * @returns Fresh tag entry.
 */
export function makeTagInfo(
  tag: string,
  overrides: Partial<TagInfo> = {},
): TagInfo {
  return {
    sha: '8f152de45cc393bb48ce5d89d36b731f54556e65',
    message: null,
    date: null,
    tag,
    ...overrides,
  }
}
