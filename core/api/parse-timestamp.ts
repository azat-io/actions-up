/**
 * Read a timestamp GitHub sent in ISO 8601 format.
 *
 * A missing or unreadable value is null rather than an invalid date, so every
 * caller has to treat it as unknown: an invalid date compares false against
 * everything, and a check written as "is it too recent?" would let it through.
 *
 * @param value - Timestamp as GitHub sent it.
 * @returns The moment, or null when there is none.
 */
export function parseTimestamp(value: undefined | string | null): Date | null {
  let date = new Date(value ?? Number.NaN)
  return Number.isNaN(date.getTime()) ? null : date
}
