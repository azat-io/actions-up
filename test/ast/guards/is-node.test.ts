import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isNode } from '../../../core/ast/guards/is-node'

describe('isNode', () => {
  it('returns true for YAML nodes', () => {
    let document_ = parseDocument('key: value')
    expect(isNode(document_.contents)).toBeTruthy()
  })

  it('returns true for objects with toJSON function', () => {
    let nodeLike = {
      toJSON: () => ({ key: 'value' }),
    }
    expect(isNode(nodeLike)).toBeTruthy()
  })

  it('returns false for objects without toJSON', () => {
    expect(isNode({})).toBeFalsy()
    expect(isNode({ other: 'property' })).toBeFalsy()
    expect(isNode({ toJSON: 'not a function' })).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(isNode(null)).toBeFalsy()
    expect(isNode(undefined)).toBeFalsy()
    expect(isNode('string')).toBeFalsy()
    expect(isNode(123)).toBeFalsy()
    expect(isNode(true)).toBeFalsy()
    expect(isNode([])).toBeFalsy()
  })

  it('works as type guard', () => {
    let document_ = parseDocument('test: value')
    let value: unknown = document_.contents
    let result = isNode(value)
    expect(result).toBeTruthy()
    let typedValue = value as { toJSON(): unknown }
    expect(typedValue.toJSON()).toEqual({ test: 'value' })
  })
})
