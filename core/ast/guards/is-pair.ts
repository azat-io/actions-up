import type { Pair } from 'yaml'

/**
 * Type guard to check if a node is a YAML key-value pair.
 *
 * @param node - The node to check.
 * @returns True if the node is a Pair.
 */
export function isPair(node: unknown): node is Pair {
  return (
    node !== null &&
    typeof node === 'object' &&
    'key' in node &&
    'value' in node
  )
}
