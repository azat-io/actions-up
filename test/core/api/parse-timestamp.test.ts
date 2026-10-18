import { describe, expect, it } from 'vitest'

import { parseTimestamp } from '../../../core/api/parse-timestamp'

describe('parseTimestamp', () => {
  it('reads an ISO 8601 timestamp', () => {
    expect(parseTimestamp('2026-07-20T16:20:48Z')).toStrictEqual(
      new Date('2026-07-20T16:20:48.000Z'),
    )
  })

  it.each([
    ['a missing value', null],
    ['an absent value', undefined],
    ['a value that is no date', 'not a date'],
  ])('answers null for %s', (_case, value) => {
    expect(parseTimestamp(value)).toBeNull()
  })
})
