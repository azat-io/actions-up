import { describe, expect, it } from 'vitest'

import { hasRange } from '../../../core/ast/guards/has-range'

describe('hasRange', () => {
  it('returns true for objects with range property', () => {
    expect(hasRange({ range: [0, 10, 5] })).toBeTruthy()
    expect(hasRange({ range: undefined })).toBeTruthy()
    expect(hasRange({ range: null })).toBeTruthy()
    expect(hasRange({ range: [] })).toBeTruthy()
  })

  it('returns false for objects without range property', () => {
    expect(hasRange({})).toBeFalsy()
    expect(hasRange({ other: 'property' })).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(hasRange(null)).toBeFalsy()
    expect(hasRange(undefined)).toBeFalsy()
    expect(hasRange('string')).toBeFalsy()
    expect(hasRange(123)).toBeFalsy()
    expect(hasRange(true)).toBeFalsy()
    expect(hasRange([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = { range: [1, 2, 3] }
    let result = hasRange(value)
    expect(result).toBeTruthy()
    let typedValue = value as { range: unknown }
    expect(typedValue.range).toBeDefined()
  })
})
