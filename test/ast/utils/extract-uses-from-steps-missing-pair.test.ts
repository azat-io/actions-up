import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { extractUsesFromSteps } from '../../../core/ast/utils/extract-uses-from-steps'
import { createNodeVisitor } from '../../../core/ast/utils/create-node-visitor'

describe('extractUsesFromSteps (missing uses pair)', () => {
  it('falls back to line 0 when AST pair is missing', () => {
    let stepNode = {
      toJSON: () => ({ uses: 'actions/checkout@v4' }),
      items: [],
    }
    let stepsNode = { items: [stepNode] }

    let actions = extractUsesFromSteps({
      visit: createNodeVisitor(parseDocument('')),
      filePath: 'workflow.yml',
      content: 'content',
      stepsNode,
    })
    expect(actions).toHaveLength(1)
    expect(actions[0]!.line).toBe(0)
    expect(actions[0]!.name).toBe('actions/checkout')
  })
})
