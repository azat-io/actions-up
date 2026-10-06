import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'

import { createNodeVisitor } from '../../../../core/ast/utils/create-node-visitor'

describe('createNodeVisitor', () => {
  it('hands out a node only the first time', () => {
    let document = parseDocument('steps: []\n')
    let steps = document.get('steps', true)
    let visit = createNodeVisitor(document)

    expect(visit(steps)).toBe(steps)
    expect(visit(steps)).toBeNull()
  })

  it('follows an alias to the node its anchor defines', () => {
    let document = parseDocument(
      'first: &step { uses: a/b@v1 }\nsecond: *step\n',
    )
    let visit = createNodeVisitor(document)

    expect(visit(document.get('second', true))).toBe(
      document.get('first', true),
    )
    expect(visit(document.get('first', true))).toBeNull()
  })

  it('yields nothing for an alias without an anchor', () => {
    let document = parseDocument('steps: *missing\n')

    expect(createNodeVisitor(document)(document.get('steps', true))).toBeNull()
  })

  it.each([null, undefined])('yields nothing for %s', value => {
    expect(createNodeVisitor(parseDocument(''))(value)).toBeNull()
  })
})
