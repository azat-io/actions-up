import type { Scalar } from 'yaml'

/**
 * Type guard to check if a node is a YAML scalar value.
 *
 * @param node - The node to check.
 * @returns True if the node is a Scalar.
 */
export function isScalar(node: unknown): node is Scalar {
  return node !== null && typeof node === 'object' && 'value' in node
}
