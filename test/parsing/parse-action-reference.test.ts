import { describe, expect, it } from 'vitest'

import { parseActionReference } from '../../core/parsing/parse-action-reference'

describe('parseActionReference', () => {
  it('parses external action with version tag', () => {
    let result = parseActionReference('actions/checkout@v4', 'workflow.yml', 10)
    expect(result).toEqual({
      name: 'actions/checkout',
      file: 'workflow.yml',
      type: 'external',
      version: 'v4',
      line: 10,
    })
  })

  it('parses external action with SHA hash', () => {
    let result = parseActionReference(
      'actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65',
      'workflow.yml',
      5,
    )
    expect(result).toEqual({
      version: '8f152de45cc393bb48ce5d89d36b731f54556e65',
      name: 'actions/setup-node',
      file: 'workflow.yml',
      type: 'external',
      line: 5,
    })
  })

  it('parses external action with branch name', () => {
    let result = parseActionReference(
      'octocat/hello-world@main',
      'workflow.yml',
      15,
    )
    expect(result).toEqual({
      name: 'octocat/hello-world',
      file: 'workflow.yml',
      type: 'external',
      version: 'main',
      line: 15,
    })
  })

  it('parses local action with relative path', () => {
    let result = parseActionReference(
      './.github/actions/build',
      'workflow.yml',
      20,
    )
    expect(result).toEqual({
      name: './.github/actions/build',
      file: 'workflow.yml',
      version: undefined,
      type: 'local',
      line: 20,
    })
  })

  it('parses external action with subpath', () => {
    let result = parseActionReference(
      'owner/repo/path/to/action@v1',
      'workflow.yml',
      12,
    )
    expect(result).toEqual({
      name: 'owner/repo/path/to/action',
      file: 'workflow.yml',
      type: 'external',
      version: 'v1',
      line: 12,
    })
  })

  it('parses docker action', () => {
    let result = parseActionReference(
      'docker://alpine:3.19',
      'workflow.yml',
      25,
    )
    expect(result).toEqual({
      name: 'docker://alpine:3.19',
      file: 'workflow.yml',
      version: undefined,
      type: 'docker',
      line: 25,
    })
  })

  it('returns null for invalid reference format', () => {
    let result = parseActionReference('invalid-format', 'workflow.yml', 30)
    expect(result).toBeNull()
  })

  it('returns null for empty reference', () => {
    let result = parseActionReference('', 'workflow.yml', 35)
    expect(result).toBeNull()
  })

  it.each([
    ['owner/repo@', 'missing version after @'],
    ['@version', 'missing owner/repo'],
    ['owner@version', 'missing repo name'],
    ['/repo@version', 'missing owner'],
    ['owner/repo/@version', 'empty segment in path'],
  ])('returns null for malformed reference: %s (%s)', reference => {
    let result = parseActionReference(reference, 'workflow.yml', 40)
    expect(result).toBeNull()
  })

  it('parses reusable workflow reference with .yml extension', () => {
    let result = parseActionReference(
      'org/repo/.github/workflows/ci.yml@v1.0.0',
      'workflow.yml',
      10,
    )
    expect(result).toEqual({
      name: 'org/repo/.github/workflows/ci.yml',
      type: 'reusable-workflow',
      file: 'workflow.yml',
      version: 'v1.0.0',
      line: 10,
    })
  })

  it('parses reusable workflow reference with .yaml extension', () => {
    let result = parseActionReference(
      'org/repo/.github/workflows/ci.yaml@main',
      'workflow.yml',
      15,
    )
    expect(result).toEqual({
      name: 'org/repo/.github/workflows/ci.yaml',
      type: 'reusable-workflow',
      file: 'workflow.yml',
      version: 'main',
      line: 15,
    })
  })

  it('parses reusable workflow with nested path', () => {
    let result = parseActionReference(
      'owner/repo/path/to/workflow.yml@v2.5.0',
      'workflow.yml',
      20,
    )
    expect(result).toEqual({
      name: 'owner/repo/path/to/workflow.yml',
      type: 'reusable-workflow',
      file: 'workflow.yml',
      version: 'v2.5.0',
      line: 20,
    })
  })

  it('distinguishes action from reusable workflow', () => {
    let action = parseActionReference('actions/checkout@v3', 'workflow.yml', 5)
    expect(action?.type).toBe('external')

    let workflow = parseActionReference(
      'org/repo/.github/workflows/test.yml@v1',
      'workflow.yml',
      10,
    )
    expect(workflow?.type).toBe('reusable-workflow')
  })

  it('parses reusable workflow with SHA reference', () => {
    let result = parseActionReference(
      'org/repo/.github/workflows/reusable.yml@a1b2c3d4e5f6789012345678901234567890abcd',
      'workflow.yml',
      25,
    )
    expect(result).toEqual({
      version: 'a1b2c3d4e5f6789012345678901234567890abcd',
      name: 'org/repo/.github/workflows/reusable.yml',
      type: 'reusable-workflow',
      file: 'workflow.yml',
      line: 25,
    })
  })

  it('does not classify action with subpath as reusable workflow', () => {
    let result = parseActionReference(
      'owner/repo/path/to/action@v1',
      'workflow.yml',
      30,
    )
    expect(result?.type).toBe('external')
  })
})
