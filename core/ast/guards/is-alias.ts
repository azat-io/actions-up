import type { Alias } from 'yaml'

/**
 * Type guard to check if a node is a YAML alias (`*anchor`).
 *
 * @param node - The node to check.
 * @returns True if the node is an Alias that can resolve to its anchor.
 */
export function isAlias(node: unknown): node is Alias {
  return (
    node !== null &&
    typeof node === 'object' &&
    'resolve' in node &&
    typeof node.resolve === 'function'
  )
}
