import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { scanCompositeActionAst } from '../../../core/ast/scanners/scan-composite-action-ast'

describe('scanCompositeActionAst', () => {
  it('scans actions from composite action AST (runs -> steps)', () => {
    let content = `${[
      'name: My Action',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - uses: actions/setup-node@v5',
      '    - run: echo "hi"',
    ].join('\n')}\n`
    let document_ = parseDocument(content)
    let actions = scanCompositeActionAst(
      document_,
      content,
      '.github/actions/setup/action.yml',
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: 'actions/setup-node',
      type: 'external',
      version: 'v5',
    })
  })

  it('returns empty when runs/steps missing or not composite', () => {
    let content = `${['name: Bad', 'runs:', '  using: docker', '  image: Dockerfile'].join('\n')}\n`
    let document_ = parseDocument(content)
    expect(scanCompositeActionAst(document_, content, 'file.yml')).toEqual([])
  })
})
