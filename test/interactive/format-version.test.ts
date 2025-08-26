import { describe, expect, it } from 'vitest'

import { formatVersion } from '../../core/interactive/format-version'
import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('formatVersion', () => {
  it('returns version as-is when provided', () => {
    expect(formatVersion('v1.2.3')).toBe('v1.2.3')
  })

  it('returns gray "unknown" when version is null', () => {
    let result = formatVersion(null)
    expect(stripAnsi(result)).toBe('unknown')
  })

  it('returns gray "unknown" when version is undefined', () => {
    let result = formatVersion(undefined)
    expect(stripAnsi(result)).toBe('unknown')
  })
})
