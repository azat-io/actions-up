import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isYAMLMap } from '../../../core/ast/guards/is-yaml-map'
import { isPair } from '../../../core/ast/guards/is-pair'

describe('isPair', () => {
  it('returns true for YAML Pair nodes', () => {
    let document_ = parseDocument('key: value\nother: item')
    let { contents } = document_
    let isMap = isYAMLMap(contents)
    expect(isMap).toBeTruthy()
    let mapContents = contents as { items: unknown[] }
    let [firstPair] = mapContents.items
    expect(isPair(firstPair)).toBeTruthy()
  })

  it('returns true for objects with key and value properties', () => {
    expect(isPair({ value: 'test', key: 'name' })).toBeTruthy()
    expect(isPair({ value: undefined, key: null })).toBeTruthy()
  })

  it('returns false for objects without key or value', () => {
    expect(isPair({})).toBeFalsy()
    expect(isPair({ key: 'only' })).toBeFalsy()
    expect(isPair({ value: 'only' })).toBeFalsy()
    expect(isPair({ other: 'property' })).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(isPair(null)).toBeFalsy()
    expect(isPair(undefined)).toBeFalsy()
    expect(isPair('string')).toBeFalsy()
    expect(isPair(123)).toBeFalsy()
    expect(isPair(true)).toBeFalsy()
    expect(isPair([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = { key: 'test', value: 123 }
    let result = isPair(value)
    expect(result).toBeTruthy()
    let typedValue = value as { value: unknown; key: unknown }
    expect(typedValue.key).toBe('test')
    expect(typedValue.value).toBe(123)
  })
})
