import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isYAMLMap } from '../../../core/ast/guards/is-yaml-map'

describe('isYAMLMap', () => {
  it('returns true for YAML Map nodes', () => {
    let document_ = parseDocument('key: value\nother: item')
    expect(isYAMLMap(document_.contents)).toBeTruthy()
  })

  it('returns true for objects with items as array', () => {
    expect(isYAMLMap({ items: [] })).toBeTruthy()
    expect(isYAMLMap({ items: [1, 2, 3] })).toBeTruthy()
  })

  it('returns false for objects without items property', () => {
    expect(isYAMLMap({})).toBeFalsy()
    expect(isYAMLMap({ other: 'property' })).toBeFalsy()
    expect(isYAMLMap({ key: 'test' })).toBeFalsy()
    expect(isYAMLMap({ items: null })).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(isYAMLMap(null)).toBeFalsy()
    expect(isYAMLMap(undefined)).toBeFalsy()
    expect(isYAMLMap('string')).toBeFalsy()
    expect(isYAMLMap(123)).toBeFalsy()
    expect(isYAMLMap(true)).toBeFalsy()
    expect(isYAMLMap([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let document_ = parseDocument('test: value')
    let value: unknown = document_.contents
    let result = isYAMLMap(value)
    expect(result).toBeTruthy()
    let typedValue = value as { items: unknown }
    expect(typedValue.items).toBeDefined()
    expect(Array.isArray(typedValue.items)).toBeTruthy()
  })
})
