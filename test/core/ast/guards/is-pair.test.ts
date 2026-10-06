import type { YAMLMap } from 'yaml'

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isPair } from '../../../../core/ast/guards/is-pair'

describe('isPair', () => {
  it.each([
    [
      true,
      'a map entry parsed from YAML',
      parseDocument<YAMLMap.Parsed>('name: CI\n').contents?.items[0],
    ],
    [
      true,
      'a map entry whose value is empty',
      parseDocument<YAMLMap.Parsed>('name:\n').contents?.items[0],
    ],
    [
      true,
      'a map entry written as a key without a value',
      parseDocument<YAMLMap.Parsed>('? name\n').contents?.items[0],
    ],
    [false, 'an object with only a key', { key: 'name' }],
    [false, 'an object with only a value', { value: 'CI' }],
    [false, 'null', null],
    [false, 'undefined', undefined],
    [false, 'a string', 'name: CI'],
    [false, 'a number', 0],
    [false, 'a boolean', true],
    [false, 'an array', []],
  ])('returns %s for %s', (expected, _description, node) => {
    expect(isPair(node)).toBe(expected)
  })
})
