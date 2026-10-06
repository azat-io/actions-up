import type { Document } from 'yaml'

import { isAlias } from '../guards/is-alias'

/**
 * Creates a function that hands out each node of a document to scan once.
 *
 * An alias resolves to the very node its anchor defines, so text written once
 * is reported once, where it is written: an alias of a node scanned before
 * yields nothing, while an alias whose anchor lies outside the scanned paths
 * (an `x-` extension key, for instance) still leads to it.
 *
 * @param document - Parsed document the nodes belong to.
 * @returns A function returning the node to scan, or null when there is nothing
 *   to scan: the node was handed out before, the value is empty, or the alias
 *   cannot be resolved.
 */
export function createNodeVisitor(
  document: Document,
): (node: unknown) => unknown {
  let visited = new WeakSet<object>()

  return node => {
    let target: unknown = isAlias(node) ? node.resolve(document) : node

    if (target === null || typeof target !== 'object' || visited.has(target)) {
      return null
    }

    visited.add(target)
    return target
  }
}
