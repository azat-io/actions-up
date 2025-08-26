import type { Node } from 'yaml'

/**
 * Type guard to check if a node is a YAML Node with toJSON method.
 *
 * @param node - The node to check.
 * @returns True if the node has a toJSON method.
 */
export function isNode(node: unknown): node is Node {
  return (
    node !== null &&
    typeof node === 'object' &&
    'toJSON' in node &&
    typeof node.toJSON === 'function'
  )
}
