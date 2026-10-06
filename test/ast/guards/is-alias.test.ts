import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { isAlias } from '../../../core/ast/guards/is-alias'

describe('isAlias', () => {
  it('returns true for a YAML alias node', () => {
    let document_ = parseDocument('first: &value 1\nsecond: *value\n')

    expect(isAlias(document_.get('second', true))).toBeTruthy()
  })

  it('returns false for the anchored node and other YAML nodes', () => {
    let document_ = parseDocument(
      'first: &value 1\nsecond: *value\nlist: [a]\n',
    )

    expect(isAlias(document_.get('first', true))).toBeFalsy()
    expect(isAlias(document_.get('list', true))).toBeFalsy()
    expect(isAlias(document_.contents)).toBeFalsy()
  })

  it('returns false for non-objects', () => {
    expect(isAlias(null)).toBeFalsy()
    expect(isAlias(undefined)).toBeFalsy()
    expect(isAlias('*value')).toBeFalsy()
  })
})
