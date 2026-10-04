import { afterEach, describe, expect, it } from 'vitest'

import { parseArguments } from '../../cli/parse-arguments'

/**
 * Real descriptors of the runtime facts the version line reports, restored
 * after every test.
 */
let realRuntime = {
  platform: Object.getOwnPropertyDescriptor(process, 'platform')!,
  version: Object.getOwnPropertyDescriptor(process, 'version')!,
  arch: Object.getOwnPropertyDescriptor(process, 'arch')!,
}

describe('parseArguments', () => {
  afterEach(() => {
    Object.defineProperties(process, realRuntime)
  })

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

  it.each(['--help', '-h'])('returns the help text for %s', flag => {
    let result = parseArguments([flag], '1.0.0')

    expect(result).toStrictEqual({
      text: expect.stringContaining(
        'Usage:\n  $ actions-up [options]',
      ) as string,
      kind: 'help',
    })
  })

  it.each(['--version', '-v'])('returns the version line for %s', flag => {
    Object.defineProperties(process, {
      version: { value: 'v24.11.0' },
      platform: { value: 'linux' },
      arch: { value: 'x64' },
    })

    let result = parseArguments([flag], '1.2.3')

    expect(result).toStrictEqual({
      text: 'actions-up/1.2.3 linux-x64 node-v24.11.0',
      kind: 'version',
    })
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

    expect(result).toStrictEqual({
      message: 'Invalid --min-age "abc". Expected a non-negative number.',
      kind: 'error',
    })
  })

  it('rejects a negative --min-age', () => {
    let result = parseArguments(['--min-age=-1'], '1.0.0')

    expect(result).toStrictEqual({
      message: 'Invalid --min-age "-1". Expected a non-negative number.',
      kind: 'error',
    })
  })

  it.each([
    {
      message: 'Invalid --min-age "". Expected a non-negative number.',
      argv: ['--min-age='],
      given: 'an empty',
    },
    {
      message: 'Invalid --min-age "  ". Expected a non-negative number.',
      argv: ['--min-age', '  '],
      given: 'a blank',
    },
  ])(
    'rejects $given --min-age instead of switching the cool-down off',
    ({ message, argv }) => {
      let result = parseArguments(argv, '1.0.0')

      expect(result).toStrictEqual({ kind: 'error', message })
    },
  )

  it('rejects a non-finite --min-age', () => {
    let result = parseArguments(['--min-age', 'Infinity'], '1.0.0')

    expect(result).toStrictEqual({
      message: 'Invalid --min-age "Infinity". Expected a non-negative number.',
      kind: 'error',
    })
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

  it('collects repeatable --min-age-exclude into an array', () => {
    let result = parseArguments(
      ['--min-age-exclude', '^my-org/', '--min-age-exclude', 'a,b'],
      'x',
    )

    expect(result).toEqual({
      options: {
        minAgeExclude: ['^my-org/', 'a,b'],
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

  it('parses --prefer-tags', () => {
    let result = parseArguments(['--prefer-tags'], 'x')

    expect(result).toEqual({
      options: {
        preferTags: true,
        mode: 'major',
        dryRun: false,
        style: 'sha',
        yes: false,
        minAge: 1,
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

  it('returns an error naming an unknown option', () => {
    let result = parseArguments(['--bogus'], 'x')

    expect(result).toStrictEqual({
      message: expect.stringContaining("'--bogus'") as string,
      kind: 'error',
    })
  })

  it('returns an error naming an unexpected positional argument', () => {
    let result = parseArguments(['somewhere'], 'x')

    expect(result).toStrictEqual({
      message: expect.stringContaining("'somewhere'") as string,
      kind: 'error',
    })
  })
})
