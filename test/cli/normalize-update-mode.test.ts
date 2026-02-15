import { describe, expect, it } from 'vitest'

import { normalizeUpdateMode } from '../../cli/normalize-update-mode'

describe('normalizeUpdateMode', () => {
  it('returns major for undefined', () => {
    let result = normalizeUpdateMode(undefined)

    expect(result).toBe('major')
  })

  it('returns major for major', () => {
    let result = normalizeUpdateMode('major')

    expect(result).toBe('major')
  })

  it('returns minor for minor', () => {
    let result = normalizeUpdateMode('minor')

    expect(result).toBe('minor')
  })

  it('returns patch for patch', () => {
    let result = normalizeUpdateMode('patch')

    expect(result).toBe('patch')
  })

  it('handles uppercase input', () => {
    let result = normalizeUpdateMode('MAJOR')

    expect(result).toBe('major')
  })

  it('handles mixed case input', () => {
    let result = normalizeUpdateMode('Minor')

    expect(result).toBe('minor')
  })

  it('throws for invalid mode', () => {
    expect(() => normalizeUpdateMode('invalid')).toThrowError(
      'Invalid mode "invalid". Expected "major", "minor", or "patch".',
    )
  })
})
