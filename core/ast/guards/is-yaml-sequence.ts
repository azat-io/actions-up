import type { YAMLSeq } from 'yaml'

/**
 * Type guard to check if a node is a YAML sequence (array).
 *
 * @param node - The node to check.
 * @returns True if the node is a YAMLSeq.
 */
export function isYAMLSequence(node: unknown): node is YAMLSeq {
  return (
    node !== null &&
    typeof node === 'object' &&
    'items' in node &&
    Array.isArray((node as YAMLSeq).items)
  )
}
