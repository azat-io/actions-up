import type { YAMLMap } from 'yaml'

/**
 * Type guard to check if a node is a YAML map (object).
 *
 * @param node - The node to check.
 * @returns True if the node is a YAMLMap.
 */
export function isYAMLMap(node: unknown): node is YAMLMap {
  return (
    node !== null &&
    typeof node === 'object' &&
    'items' in node &&
    Array.isArray((node as YAMLMap).items)
  )
}
