import { describe, expect, it } from 'vitest'

import { parseArguments } from '../../cli/parse-arguments'

describe('parseArguments', () => {
  it('applies defaults when no arguments are passed', () => {
    let result = parseArguments([], '1.0.0')

    expect(result).toEqual({
      options: {
        mode: 'major',
        dryRun: false,
        style: 'sha',
        yes: false,
        minAge: 1,
      },
      kind: 'options',
    })
  })

  it('returns help text for --help', () => {
    let result = parseArguments(['--help'], '1.0.0')

    expect(result.kind).toBe('help')
  })

  it('returns help text for -h', () => {
    let result = parseArguments(['-h'], '1.0.0')

    expect(result.kind).toBe('help')
  })

  it('returns version string for --version', () => {
    let result = parseArguments(['--version'], '1.2.3')

    expect(result).toEqual({
      text: `actions-up/1.2.3 ${process.platform}-${process.arch} node-${process.version}`,
      kind: 'version',
    })
  })

  it('returns version string for -v', () => {
    let result = parseArguments(['-v'], '1.2.3')

    expect(result.kind).toBe('version')
  })

  it('coerces --min-age to a number', () => {
    let result = parseArguments(['--min-age', '7'], '1.0.0')

    expect(result).toEqual({
      options: {
        mode: 'major',
        dryRun: false,
        style: 'sha',
        yes: false,
        minAge: 7,
      },
      kind: 'options',
    })
  })

  it('allows disabling the cool-down with --min-age 0', () => {
    let result = parseArguments(['--min-age', '0'], '1.0.0')

    expect(result).toEqual({
      options: {
        mode: 'major',
        dryRun: false,
        style: 'sha',
        yes: false,
        minAge: 0,
      },
      kind: 'options',
    })
  })

  it('rejects a non-numeric --min-age', () => {
    let result = parseArguments(['--min-age', 'abc'], '1.0.0')

    expect(result).toEqual({
      message: 'Invalid --min-age "abc". Expected a non-negative number.',
      kind: 'error',
    })
  })

  it('rejects a negative --min-age', () => {
    let result = parseArguments(['--min-age=-1'], '1.0.0')

    expect(result).toEqual({
      message: 'Invalid --min-age "-1". Expected a non-negative number.',
      kind: 'error',
    })
  })

  it('rejects a non-finite --min-age', () => {
    let result = parseArguments(['--min-age', 'Infinity'], '1.0.0')

    expect(result.kind).toBe('error')
  })

  it('reads --mode and --style values', () => {
    let result = parseArguments(['--mode', 'minor', '--style', 'preserve'], 'x')

    expect(result).toEqual({
      options: {
        style: 'preserve',
        mode: 'minor',
        dryRun: false,
        yes: false,
        minAge: 1,
      },
      kind: 'options',
    })
  })

  it('collects repeatable --dir and --exclude into arrays', () => {
    let result = parseArguments(
      ['--dir', 'a', '--dir', 'b', '--exclude', 'x', '--exclude', 'y'],
      'x',
    )

    expect(result).toEqual({
      options: {
        exclude: ['x', 'y'],
        dir: ['a', 'b'],
        mode: 'major',
        dryRun: false,
        style: 'sha',
        yes: false,
        minAge: 1,
      },
      kind: 'options',
    })
  })

  it('parses boolean flags', () => {
    let result = parseArguments(
      [
        '--dry-run',
        '--json',
        '--recursive',
        '--include-branches',
        '--yes',
        '--quiet',
      ],
      'x',
    )

    expect(result).toEqual({
      options: {
        includeBranches: true,
        recursive: true,
        mode: 'major',
        dryRun: true,
        style: 'sha',
        quiet: true,
        json: true,
        minAge: 1,
        yes: true,
      },
      kind: 'options',
    })
  })

  it('parses short boolean aliases', () => {
    let result = parseArguments(['-r', '-y', '-q'], 'x')

    expect(result).toEqual({
      options: {
        recursive: true,
        mode: 'major',
        dryRun: false,
        style: 'sha',
        quiet: true,
        minAge: 1,
        yes: true,
      },
      kind: 'options',
    })
  })

  it('returns an error for unknown options', () => {
    let result = parseArguments(['--bogus'], 'x')

    expect(result.kind).toBe('error')
  })

  it('returns an error for unexpected positional arguments', () => {
    let result = parseArguments(['somewhere'], 'x')

    expect(result.kind).toBe('error')
  })
})
