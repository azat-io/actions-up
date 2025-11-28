import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { extractUsesFromSteps } from '../../../core/ast/utils/extract-uses-from-steps'
import { findMapPair } from '../../../core/ast/utils/find-map-pair'

describe('extractUsesFromSteps', () => {
  it('extracts uses actions from steps YAML sequence', () => {
    let content = `${[
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: echo "hi"',
    ].join('\n')}\n`
    let filePath = '.github/workflows/ci.yml'
    let document_ = parseDocument(content)
    let jobs = findMapPair(document_.contents, 'jobs')
    let build = jobs?.value ? findMapPair(jobs.value, 'build') : null
    let steps = build?.value ? findMapPair(build.value, 'steps') : null
    expect(steps?.value).toBeTruthy()

    let actions = extractUsesFromSteps({
      stepsNode: steps!.value,
      filePath,
      content,
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: 'actions/checkout',
      type: 'external',
      file: filePath,
      version: 'v4',
    })
    expect(typeof actions[0]!.line).toBe('number')
  })

  it('returns empty when steps node is not a YAML sequence', () => {
    let actions = extractUsesFromSteps({
      filePath: 'file.yml',
      content: 'content',
      stepsNode: {},
    })
    expect(actions).toEqual([])
  })
})
