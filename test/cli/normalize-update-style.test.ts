import { describe, expect, it } from 'vitest'

import { normalizeUpdateStyle } from '../../cli/normalize-update-style'

describe('normalizeUpdateStyle', () => {
  it('returns sha for undefined', () => {
    let result = normalizeUpdateStyle(undefined)

    expect(result).toBe('sha')
  })

  it('returns sha for sha', () => {
    let result = normalizeUpdateStyle('sha')

    expect(result).toBe('sha')
  })

  it('returns preserve for preserve', () => {
    let result = normalizeUpdateStyle('preserve')

    expect(result).toBe('preserve')
  })

  it('handles uppercase input', () => {
    let result = normalizeUpdateStyle('SHA')

    expect(result).toBe('sha')
  })

  it('handles mixed case input', () => {
    let result = normalizeUpdateStyle('Preserve')

    expect(result).toBe('preserve')
  })

  it('throws for invalid style', () => {
    expect(() => normalizeUpdateStyle('tag')).toThrow(
      'Invalid style "tag". Expected "sha" or "preserve".',
    )
  })
})
