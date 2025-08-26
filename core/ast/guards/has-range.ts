/**
 * Type guard to check if a node has a range property for line number
 * calculation.
 *
 * @param node - The node to check.
 * @returns True if the node has a range property.
 */
export function hasRange(
  node: unknown,
): node is { range?: [number, number, number] } {
  return node !== null && typeof node === 'object' && 'range' in node
}
