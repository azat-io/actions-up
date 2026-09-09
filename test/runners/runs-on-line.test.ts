import { describe, expect, it } from 'vitest'

import { buildRunsOnPattern, getLine } from '../../core/runners/runs-on-line'

describe('buildRunsOnPattern', () => {
  it.each([
    '    runs-on: ubuntu-22.04',
    "    runs-on: 'ubuntu-22.04'",
    '    runs-on: "ubuntu-22.04"',
    '    "runs-on": ubuntu-22.04',
    '    runs-on: ubuntu-22.04 # pinned',
    '    runs-on:   ubuntu-22.04',
    'runs-on: ubuntu-22.04',
    '    runs-on: ubuntu-22.04\r',
    '    runs-on: ubuntu-22.04 # pinned\r',
  ])('matches %j', line => {
    expect(buildRunsOnPattern('ubuntu-22.04').test(line)).toBeTruthy()
  })

  it.each([
    ['an anchored value', '    runs-on: &runner ubuntu-22.04'],
    ['a key without a value', '    runs-on:'],
    ['a flow mapping', '    build: { runs-on: ubuntu-22.04 }'],
    ['a different label', '    runs-on: ubuntu-24.04'],
    ['a suffixed label', '    runs-on: ubuntu-22.04-arm'],
    ['a sequence', '    runs-on: [ubuntu-22.04]'],
    ['trailing content after the label', '    runs-on: ubuntu-22.04 nonsense'],
  ])('does not match %s', (_description, line) => {
    expect(buildRunsOnPattern('ubuntu-22.04').test(line)).toBeFalsy()
  })

  it('captures the parts needed to rebuild the line', () => {
    let match = buildRunsOnPattern('ubuntu-22.04').exec(
      '    runs-on: "ubuntu-22.04"  # pinned\r',
    )
    expect(match?.groups).toMatchObject({
      prefix: '    runs-on: ',
      comment: '# pinned',
      after: '  ',
      quote: '"',
      eol: '\r',
    })
  })

  it('treats the label literally', () => {
    let pattern = buildRunsOnPattern('ubuntu-22.04')
    expect(pattern.test('    runs-on: ubuntu-22X04')).toBeFalsy()
  })
})

describe('getLine', () => {
  let content = ['first', 'second', 'third'].join('\n')

  it('returns a 1-based line', () => {
    expect(getLine(content, 1)).toBe('first')
    expect(getLine(content, 3)).toBe('third')
  })

  it('returns null for a non-positive line number', () => {
    expect(getLine(content, 0)).toBeNull()
    expect(getLine(content, -1)).toBeNull()
  })

  it('returns null past the end of the content', () => {
    expect(getLine(content, 99)).toBeNull()
  })
})
