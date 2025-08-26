import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isYAMLSequence } from '../../../core/ast/guards/is-yaml-sequence'

describe('isYAMLSequence', () => {
  it('returns true for YAML Sequence nodes', () => {
    let document_ = parseDocument('- item1\n- item2\n- item3')
    expect(isYAMLSequence(document_.contents)).toBeTruthy()
  })

  it('returns true for nested arrays in YAML', () => {
    let document_ = parseDocument('items:\n  - one\n  - two')
    let contents = document_.contents as unknown as Record<string, unknown>
    let items = contents['items'] as unknown[]
    expect(items).toBeDefined()
    expect(items[0]).toBeDefined()
    expect(typeof items[0]).toBe('object')
    expect('value' in (items[0] as object)).toBeTruthy()
    let firstItem = items[0] as { value: unknown }
    expect(isYAMLSequence(firstItem.value)).toBeTruthy()
  })

  it('returns true for objects with items array', () => {
    expect(isYAMLSequence({ items: [] })).toBeTruthy()
    expect(isYAMLSequence({ items: [1, 2, 3] })).toBeTruthy()
  })

  it('returns false for objects with non-array items', () => {
    expect(isYAMLSequence({ items: 'not array' })).toBeFalsy()
    expect(isYAMLSequence({ items: null })).toBeFalsy()
    expect(isYAMLSequence({ items: {} })).toBeFalsy()
  })

  it('returns false for objects without items property', () => {
    expect(isYAMLSequence({})).toBeFalsy()
    expect(isYAMLSequence({ other: [] })).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(isYAMLSequence(null)).toBeFalsy()
    expect(isYAMLSequence(undefined)).toBeFalsy()
    expect(isYAMLSequence('string')).toBeFalsy()
    expect(isYAMLSequence(123)).toBeFalsy()
    expect(isYAMLSequence(true)).toBeFalsy()
    expect(isYAMLSequence([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let document_ = parseDocument('- test\n- value')
    let value: unknown = document_.contents
    let result = isYAMLSequence(value)
    expect(result).toBeTruthy()
    let typedValue = value as { items: unknown[] }
    expect(Array.isArray(typedValue.items)).toBeTruthy()
    expect(typedValue.items.length).toBeGreaterThan(0)
  })
})
