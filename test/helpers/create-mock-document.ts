/**
 * The part of a parsed YAML document that the scanners read.
 */
export interface ScannedDocument {
  /**
   * Root node of the document.
   */
  contents?: unknown

  /**
   * Plain JavaScript value of the whole document.
   */
  toJSON(): unknown
}

/**
 * Hand-built YAML node: a pair, a map or a sequence item.
 */
interface MockNode {
  /**
   * Value of a pair: a nested map or sequence, or a plain scalar value.
   */
  value?: { toJSON?(): unknown; items: MockNode[] } | unknown

  /**
   * Plain JavaScript value of a sequence item.
   */
  toJSON?(): unknown

  /**
   * Pairs of a sequence item that is a map.
   */
  items?: MockNode[]

  /**
   * Key of a pair.
   */
  key?: MockKey
}

/**
 * Hand-built YAML document with a map at its root.
 */
interface MockDocument {
  /**
   * Root map of the document.
   */
  contents: { items: MockNode[] }

  /**
   * Plain JavaScript value of the whole document.
   */
  toJSON(): unknown
}

/**
 * Key of a hand-built pair, with the range used to compute line numbers.
 */
interface MockKey {
  /**
   * Source range of the key.
   */
  range: [number, number, number]

  /**
   * Key name.
   */
  value: string
}

/**
 * Build a YAML document mock that mirrors the given data, so scanner tests can
 * supply ASTs without parsing real YAML.
 *
 * Objects become maps with pairs, and sequence items that are plain values
 * become nodes without `items`, the way YAML scalars have none.
 *
 * @param data - Plain value the document represents.
 * @returns Document whose nodes follow the shape of `data`.
 */
export function createMockDocument(data: unknown): MockDocument {
  function createMockNode(
    key: string,
    value: unknown,
    range?: [number, number, number],
  ): MockNode {
    if (Array.isArray(value)) {
      let array = value as unknown[]
      return {
        value: {
          items: array.map((item: unknown, index: number) => {
            if (typeof item === 'object' && item !== null) {
              return {
                items: Object.entries(item as Record<string, unknown>).map(
                  ([entryKey, entryValue]) =>
                    createMockNode(entryKey, entryValue, [
                      index * 20,
                      index * 20 + 1,
                      index * 20 + 1,
                    ]),
                ),
                toJSON: (): unknown => item,
              }
            }
            return { toJSON: (): unknown => item }
          }),
        },
        key: { range: range ?? [0, 1, 1], value: key },
      }
    }
    if (typeof value === 'object' && value !== null) {
      return {
        value: {
          items: Object.entries(value as Record<string, unknown>).map(
            ([entryKey, entryValue]) => createMockNode(entryKey, entryValue),
          ),
          toJSON: () => value,
        },
        key: { range: range ?? [0, 1, 1], value: key },
      }
    }
    return {
      key: { range: range ?? [0, 1, 1], value: key },
      value,
    }
  }

  return {
    contents: {
      items: Object.entries(
        typeof data === 'object' && data !== null ?
          (data as Record<string, unknown>)
        : {},
      ).map(([entryKey, entryValue]) => createMockNode(entryKey, entryValue)),
    },
    toJSON: () => data,
  }
}
