import { describe, expect, it, vi } from 'vitest'
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

  it('returns empty when steps entry is absent in runs map', () => {
    let content = `${[
      'name: Missing steps',
      'runs:',
      '  using: composite',
      '  env:',
      '    NODE_VERSION: 20',
    ].join('\n')}\n`
    let document_ = parseDocument(content)
    expect(scanCompositeActionAst(document_, content, 'file.yml')).toEqual([])
  })

  it('returns empty when steps pair lacks AST value despite JSON array', () => {
    let content = 'runs:\n  using: composite\n  steps: []\n'
    let document_ = parseDocument(content)
    document_.setIn(['runs', 'steps'], null)
    vi.spyOn(document_, 'toJSON').mockReturnValue({
      runs: {
        using: 'composite',
        steps: [],
      },
    })

    expect(scanCompositeActionAst(document_, content, 'file.yml')).toEqual([])
  })
})
