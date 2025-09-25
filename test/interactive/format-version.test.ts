import { describe, expect, it } from 'vitest'

import { formatVersion } from '../../core/interactive/format-version'
import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('formatVersion', () => {
  it('returns version as-is when provided', () => {
    expect(formatVersion('v1.2.3', null)).toBe('v1.2.3')
  })

  it('returns gray "unknown" when version is null', () => {
    let result = formatVersion(null, null)
    expect(stripAnsi(result)).toBe('unknown')
  })

  it('returns gray "unknown" when version is undefined', () => {
    let result = formatVersion(undefined, null)
    expect(stripAnsi(result)).toBe('unknown')
  })

  it('handles major change from 1.x to 2.0.0', () => {
    let result = formatVersion('2.0.0', '1.2.3')
    expect(stripAnsi(result)).toBe('2.0.0')
  })

  it('handles stable minor change 1.2.3 -> 1.3.0', () => {
    let result = formatVersion('1.3.0', '1.2.3')
    expect(stripAnsi(result)).toBe('1.3.0')
  })

  it('handles stable patch change 1.2.3 -> 1.2.4', () => {
    let result = formatVersion('1.2.4', '1.2.3')
    expect(stripAnsi(result)).toBe('1.2.4')
  })

  it('handles unstable minor change 0.1.0 -> 0.2.0', () => {
    let result = formatVersion('0.2.0', '0.1.0')
    expect(stripAnsi(result)).toBe('0.2.0')
  })

  it('handles unstable patch change 0.1.0 -> 0.1.1', () => {
    let result = formatVersion('0.1.1', '0.1.0')
    expect(stripAnsi(result)).toBe('0.1.1')
  })

  it('renders without colors when versions are equal', () => {
    let result = formatVersion('1.2.3', '1.2.3')
    expect(stripAnsi(result)).toBe('1.2.3')
    expect(result).toBe(stripAnsi(result))
  })

  it('normalizes current short forms like v1 and detects patch change', () => {
    let result = formatVersion('1.0.1', 'v1')
    expect(stripAnsi(result)).toBe('1.0.1')
  })

  it('returns latest as-is when it is not a valid semver', () => {
    let result = formatVersion('not-a-version', '1.2.3')
    expect(result).toBe('not-a-version')
  })
})
