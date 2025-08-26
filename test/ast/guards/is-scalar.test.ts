import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isYAMLMap } from '../../../core/ast/guards/is-yaml-map'
import { isScalar } from '../../../core/ast/guards/is-scalar'
import { isPair } from '../../../core/ast/guards/is-pair'

describe('isScalar', () => {
  it('returns true for YAML Scalar nodes', () => {
    let document_ = parseDocument('key: value')
    let { contents } = document_
    let isMap = isYAMLMap(contents)
    expect(isMap).toBeTruthy()
    let mapContents = contents as { items: unknown[] }
    expect(mapContents.items[0]).toBeDefined()
    let [firstPair] = mapContents.items
    let pairResult = isPair(firstPair)
    expect(pairResult).toBeTruthy()
    let typedPair = firstPair as { value: unknown; key: unknown }
    expect(isScalar(typedPair.value)).toBeTruthy()
  })

  it('returns true for objects with value property', () => {
    expect(isScalar({ value: 'test' })).toBeTruthy()
    expect(isScalar({ value: 123 })).toBeTruthy()
    expect(isScalar({ value: null })).toBeTruthy()
    expect(isScalar({ value: undefined })).toBeTruthy()
  })

  it('returns false for objects without value property', () => {
    expect(isScalar({})).toBeFalsy()
    expect(isScalar({ other: 'property' })).toBeFalsy()
    expect(isScalar({ key: 'test' })).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(isScalar(null)).toBeFalsy()
    expect(isScalar(undefined)).toBeFalsy()
    expect(isScalar('string')).toBeFalsy()
    expect(isScalar(123)).toBeFalsy()
    expect(isScalar(true)).toBeFalsy()
    expect(isScalar([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let value: unknown = { value: 'test content' }
    let result = isScalar(value)
    expect(result).toBeTruthy()
    let typedValue = value as { value: unknown }
    expect(typedValue.value).toBe('test content')
  })
})
