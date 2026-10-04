import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { findMapPair } from '../../../core/ast/utils/find-map-pair'

describe('findMapPair', () => {
  it('returns the entry of a key that is not the first in the map', () => {
    let { contents } = parseDocument(
      [
        'name: CI',
        'on: push',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-24.04',
        '',
      ].join('\n'),
    )

    let pair = findMapPair(contents, 'jobs')

    expect(pair?.toJSON()).toStrictEqual({
      jobs: { build: { 'runs-on': 'ubuntu-24.04' } },
    })
  })

  it('returns null when the map has no entry with the key', () => {
    let { contents } = parseDocument('name: CI\non: push\n')

    expect(findMapPair(contents, 'jobs')).toBeNull()
  })

  it.each([
    ['nothing', null],
    ['a scalar', parseDocument('jobs\n').contents],
    [
      'a sequence that lists the key',
      parseDocument('- name\n- jobs\n').contents,
    ],
  ])('returns null for %s instead of a map', (_description, node) => {
    expect(findMapPair(node, 'jobs')).toBeNull()
  })
})
