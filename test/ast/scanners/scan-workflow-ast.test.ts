import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { scanWorkflowAst } from '../../../core/ast/scanners/scan-workflow-ast'

describe('scanWorkflowAst', () => {
  it('scans actions from workflow AST (jobs -> steps)', () => {
    let content = `${[
      'name: CI',
      'on: push',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: ./.github/actions/test',
    ].join('\n')}\n`
    let filePath = '.github/workflows/ci.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({
      name: 'actions/checkout',
      type: 'external',
      file: filePath,
      version: 'v4',
    })
    expect(actions[1]).toMatchObject({
      name: './.github/actions/test',
      type: 'local',
    })
  })

  it('returns empty for invalid workflow structure', () => {
    let content = 'name: no-jobs\n'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, 'file.yml')
    expect(actions).toEqual([])
  })
})
