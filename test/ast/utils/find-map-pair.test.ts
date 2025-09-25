import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { findMapPair } from '../../../core/ast/utils/find-map-pair'

describe('findMapPair', () => {
  it('finds existing pair by key in YAML map', () => {
    let content = 'jobs:\n  build: {}\n  test: {}\n'
    let document = parseDocument(content)
    let jobsPair = findMapPair(document.contents, 'jobs')
    expect(jobsPair).toBeTruthy()
    expect(jobsPair && 'key' in jobsPair && jobsPair.key).toBeTruthy()
    let nested = jobsPair?.value ? findMapPair(jobsPair.value, 'build') : null
    expect(nested).toBeTruthy()
  })

  it('returns null when key is not found or node is not a map', () => {
    let content = 'name: test\n'
    let document_ = parseDocument(content)
    expect(findMapPair(document_.contents, 'jobs')).toBeNull()
    expect(findMapPair(null, 'jobs')).toBeNull()
  })
})
