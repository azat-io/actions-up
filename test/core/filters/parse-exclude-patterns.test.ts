import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseExcludePatterns } from '../../../core/filters/parse-exclude-patterns'

describe('parseExcludePatterns', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array for empty or whitespace-only inputs', () => {
    expect(parseExcludePatterns([])).toStrictEqual([])
    expect(parseExcludePatterns(['', ' '.repeat(3)])).toStrictEqual([])
  })

  it('parses plain patterns as case-insensitive regex', () => {
    let compiledPatterns = parseExcludePatterns(['my-org/.*'])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.test('my-org/repo')).toBeTruthy()
    expect(compiledPatterns[0]!.test('My-Org/Repo')).toBeTruthy()
    expect(compiledPatterns[0]!.test('your-org/repo')).toBeFalsy()
  })

  it('treats /pattern/ as a regular expression, not plain text', () => {
    let compiledPatterns = parseExcludePatterns([
      String.raw`/^actions\/internal-.+$/i`,
    ])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.test('actions/internal-build')).toBeTruthy()
    expect(compiledPatterns[0]!.test('Actions/Internal-Deploy')).toBeTruthy()
    expect(compiledPatterns[0]!.test('actions/external-build')).toBeFalsy()
  })

  it('applies the flags written on a literal instead of the default', () => {
    let compiledPatterns = parseExcludePatterns(['/Foo/g'])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.flags).toBe('g')
    expect(compiledPatterns[0]!.test('foo')).toBeFalsy()
  })

  it('uses default case-insensitive flag when literal has no flags', () => {
    let compiledPatterns = parseExcludePatterns([String.raw`/my-org\/repo/`])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.test('my-org/repo')).toBeTruthy()
    expect(compiledPatterns[0]!.test('My-Org/Repo')).toBeTruthy()
    expect(compiledPatterns[0]!.test('your-org/repo')).toBeFalsy()
  })

  it('treats a leading slash without a closing one as part of a plain pattern', () => {
    let compiledPatterns = parseExcludePatterns(['/internal-'])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.test('my-org/internal-tools')).toBeTruthy()
    expect(compiledPatterns[0]!.test('internal-tools/build')).toBeFalsy()
  })

  it('trims surrounding spaces', () => {
    let compiledPatterns = parseExcludePatterns(['  my-org/.*  '])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.test('my-org/x')).toBeTruthy()
  })

  it('trims surrounding spaces before reading a literal', () => {
    let compiledPatterns = parseExcludePatterns(['  /Foo/g  '])

    expect(compiledPatterns).toHaveLength(1)
    expect(compiledPatterns[0]!.source).toBe('Foo')
    expect(compiledPatterns[0]!.flags).toBe('g')
  })

  it('skips invalid patterns and warns with the offending pattern', () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let compiledPatterns = parseExcludePatterns(['/(unclosed'])

    expect(compiledPatterns).toStrictEqual([])
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Invalid regex exclude: /(unclosed',
      expect.any(SyntaxError),
    )
  })

  it('skips literals with bad flags and warns with the offending pattern', () => {
    let warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let compiledPatterns = parseExcludePatterns(['/test/uux'])

    expect(compiledPatterns).toStrictEqual([])
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Invalid regex exclude: /test/uux',
      expect.any(SyntaxError),
    )
  })

  it('keeps the valid patterns listed around an invalid one', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    let compiledPatterns = parseExcludePatterns([
      'checkout',
      'my-org/(internal',
      '^my-org',
    ])

    expect(compiledPatterns.map(({ source }) => source)).toStrictEqual([
      'checkout',
      '^my-org',
    ])
  })
})
