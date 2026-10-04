import { describe, expect, it } from 'vitest'

import { normalizeUpdateMode } from '../../cli/normalize-update-mode'

describe('normalizeUpdateMode', () => {
  it('defaults to major when no mode is given', () => {
    let result = normalizeUpdateMode(undefined)

    expect(result).toBe('major')
  })

  it.each([
    { expected: 'major', input: 'major' },
    { expected: 'minor', input: 'minor' },
    { expected: 'patch', input: 'patch' },
    { expected: 'major', input: 'MAJOR' },
    { expected: 'minor', input: 'Minor' },
  ])('accepts $input as $expected', ({ expected, input }) => {
    let result = normalizeUpdateMode(input)

    expect(result).toBe(expected)
  })

  it('rejects an unknown mode, echoing the value as given', () => {
    expect(() => normalizeUpdateMode('Major-Only')).toThrow(
      'Invalid mode "Major-Only". Expected "major", "minor", or "patch".',
    )
  })
})
