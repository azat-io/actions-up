import { describe, expect, it } from 'vitest'

import { isRecord } from '../../../core/parsing/is-record'

describe('isRecord', () => {
  it.each([
    [{ version: 'v0.0.3' }, true],
    [Object.create(null) as object, true],
    [['v0.0.3'], false],
    [null, false],
    ['v0.0.3', false],
    [3, false],
    [undefined, false],
  ])('tells whether %o is a mapping', (value, expected) => {
    expect(isRecord(value)).toBe(expected)
  })
})
