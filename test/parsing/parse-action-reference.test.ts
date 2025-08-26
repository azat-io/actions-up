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
})
