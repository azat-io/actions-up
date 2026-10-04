import type { YAMLMap, Scalar } from 'yaml'

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { getLineNumberForKey } from '../../../core/ast/utils/get-line-number'

/**
 * Parse YAML and return the key node of the map entry at a path of keys.
 *
 * @param content - YAML text.
 * @param path - Keys leading to the entry; the last one names the entry.
 * @returns Key node of the entry.
 * @throws {Error} When the content has no entry at the path.
 */
function keyNodeAt(content: string, path: string[]): unknown {
  let parent = parseDocument(content).getIn(
    path.slice(0, -1),
    true,
  ) as YAMLMap<Scalar>
  let entry = parent.items.find(pair => pair.key.value === path.at(-1))
  if (!entry) {
    throw new Error(`No entry at ${path.join('.')}`)
  }
  return entry.key
}

describe('getLineNumberForKey', () => {
  it.each([
    [
      'the first line',
      { content: ['name: CI', 'on: push', ''].join('\n'), path: ['name'] },
      1,
    ],
    [
      'a key in the second job',
      {
        content: [
          'name: CI',
          'on: push',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-24.04',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '      - run: npm ci',
          '      - run: npm test',
          '  release:',
          '    needs: build',
          '    runs-on: ubuntu-24.04',
          '',
        ].join('\n'),
        path: ['jobs', 'release', 'runs-on'],
      },
      12,
    ],
    [
      'a file with CRLF line endings',
      {
        content: [
          'name: CI',
          'on: push',
          'jobs:',
          '  build:',
          '    runs-on: ubuntu-24.04',
          '',
        ].join('\r\n'),
        path: ['jobs', 'build', 'runs-on'],
      },
      5,
    ],
  ])(
    'returns the line of a key on %s',
    (_description, { content, path }, expectedLine) => {
      expect(getLineNumberForKey(content, keyNodeAt(content, path))).toBe(
        expectedLine,
      )
    },
  )

  it.each([
    ['a key node without a range', { value: 'name' }],
    ['a key node whose range is not set', { range: undefined, value: 'name' }],
    [
      'a range that does not start at a finite offset',
      { range: [Number.NaN, 4, 4], value: 'name' },
    ],
  ])('returns 0 for %s', (_description, keyNode) => {
    expect(getLineNumberForKey('name: CI\n', keyNode)).toBe(0)
  })
})
