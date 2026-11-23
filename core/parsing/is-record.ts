/**
 * Tell a mapping of data read from YAML or JSON apart from the other values the
 * data can hold.
 *
 * @param value - Value read from the data.
 * @returns True when the value is a mapping.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
