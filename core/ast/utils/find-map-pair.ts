import type { Pair } from 'yaml'

import { isYAMLMap } from '../guards/is-yaml-map'
import { isScalar } from '../guards/is-scalar'
import { isPair } from '../guards/is-pair'

/**
 * Finds a key-value Pair by its key within a YAML map node.
 *
 * Returns null when the provided node is not a YAML map or when no entry with
 * the given key exists.
 *
 * @param map - Candidate YAML node expected to be a map.
 * @param key - Key name to locate.
 * @returns Matching Pair when found, otherwise null.
 */
export function findMapPair(map: unknown, key: string): Pair | null {
  if (!isYAMLMap(map) || !Array.isArray(map.items)) {
    return null
  }

  let yamlMap = map
  let pair = yamlMap.items.find(
    (item): item is Pair =>
      isPair(item) && isScalar(item.key) && item.key.value === key,
  )

  return pair ?? null
}
