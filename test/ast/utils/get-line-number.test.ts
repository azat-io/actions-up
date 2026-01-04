import type { YAMLMap, YAMLSeq, Pair } from 'yaml'

import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { getLineNumberForKey } from '../../../core/ast/utils/get-line-number'
import { isYAMLSequence } from '../../../core/ast/guards/is-yaml-sequence'
import { findMapPair } from '../../../core/ast/utils/find-map-pair'
import { isYAMLMap } from '../../../core/ast/guards/is-yaml-map'
import { isScalar } from '../../../core/ast/guards/is-scalar'
import { isPair } from '../../../core/ast/guards/is-pair'

describe('getLineNumberForKey', () => {
  it('calculates 1-based line number for a key with range', () => {
    let content = `${['steps:', '  - uses: actions/checkout@v4', '  - run: echo "hi"'].join('\n')}\n`
    let document_ = parseDocument(content)
    let stepsPair = findMapPair(document_.contents, 'steps')
    expect(stepsPair?.value).toBeTruthy()

    let seqNode = stepsPair!.value
    expect(isYAMLSequence(seqNode)).toBeTruthy()
    let sequence = (seqNode as YAMLSeq).items

    let [first] = sequence
    expect(isYAMLMap(first)).toBeTruthy()
    let firstMap = first as YAMLMap

    let usesPair = firstMap.items.find(
      (pair): pair is Pair =>
        isPair(pair) && isScalar(pair.key) && pair.key.value === 'uses',
    )
    expect(usesPair).toBeTruthy()
    let line = getLineNumberForKey(content, usesPair!.key)
    expect(line).toBe(2)
  })

  it('returns 0 when key has no range', () => {
    let content = 'name: value\n'
    let document_ = parseDocument(content)
    let pair = findMapPair(document_.contents, 'name')
    expect(pair).toBeTruthy()
    expect(getLineNumberForKey(content, { value: 'name' })).toBe(0)
  })

  it('returns 0 when offset is not a finite number', () => {
    let content = 'test: value\n'
    let keyNode = { range: [Number.NaN, 0, 0] }
    expect(getLineNumberForKey(content, keyNode)).toBe(0)
  })
})
