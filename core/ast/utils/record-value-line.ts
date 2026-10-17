import type { GitHubAction } from '../../../types/github-action'

import { getLineNumberForKey } from './get-line-number'

/**
 * Record the line a value starts on, when it is written on a later line than
 * its key.
 *
 * An ignore comment written next to such a value sits on the value's line
 * rather than on the key's, so both lines have to be known to honour it.
 *
 * @param action - Entry the scan reports, with the line of its key.
 * @param source - Where the value is written.
 * @param source.node - Value node, with its position in the file.
 * @param source.content - File content.
 */
export function recordValueLine(
  action: GitHubAction,
  source: { content: string; node: unknown },
): void {
  let valueLine = getLineNumberForKey(source.content, source.node)
  if (valueLine > 0 && valueLine !== action.line) {
    action.valueLine = valueLine
  }
}
