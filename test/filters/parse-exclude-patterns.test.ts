import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseExcludePatterns } from '../../core/filters/parse-exclude-patterns'

describe('parseExcludePatterns', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array for empty or whitespace-only inputs', () => {
    expect(parseExcludePatterns([])).toEqual([])
    expect(parseExcludePatterns(['', '   '])).toEqual([])
  })

  it('parses plain patterns as case-insensitive regex', () => {
    let compiledPatterns = parseExcludePatterns(['my-org/.*'])
    expect(compiledPatterns).toHaveLength(1)
    let rx = compiledPatterns[0]!
    expect(rx.test('my-org/repo')).toBeTruthy()
    expect(rx.test('My-Org/Repo')).toBeTruthy()
    expect(rx.test('your-org/repo')).toBeFalsy()
  })

  it('parses literal form with flags /pattern/flags', () => {
    let compiledPatterns = parseExcludePatterns([
      String.raw`/^actions\/internal-.+$/i`,
    ])
    expect(compiledPatterns).toHaveLength(1)
    let rx = compiledPatterns[0]!
    expect(rx.test('actions/internal-build')).toBeTruthy()
    expect(rx.test('Actions/Internal-Deploy')).toBeTruthy()
    expect(rx.test('actions/external-build')).toBeFalsy()
  })

  it('uses default case-insensitive flag when literal has no flags', () => {
    let compiledPatterns = parseExcludePatterns([String.raw`/my-org\/repo/`])
    expect(compiledPatterns).toHaveLength(1)
    let rx = compiledPatterns[0]!
    expect(rx.test('my-org/repo')).toBeTruthy()
    expect(rx.test('My-Org/Repo')).toBeTruthy()
    expect(rx.test('your-org/repo')).toBeFalsy()
  })

  it('trims surrounding spaces', () => {
    let compiledPatterns = parseExcludePatterns(['  my-org/.*  '])
    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.test('my-org/x')).toBeTruthy()
  })

  it('skips invalid patterns and warns', () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let compiledPatterns = parseExcludePatterns(['/(unclosed'])
    expect(compiledPatterns).toHaveLength(0)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid regex exclude'),
      expect.any(SyntaxError),
    )
  })

  it('skips invalid literal patterns with bad flags and warns', () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let compiledPatterns = parseExcludePatterns([' /test/uux '])
    expect(compiledPatterns).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid regex exclude'),
      expect.any(SyntaxError),
    )
  })
})
