import { describe, expect, it } from 'vitest'

import { parseActionReference } from '../../../core/parsing/parse-action-reference'

describe('parseActionReference', () => {
  it('parses external action with version tag', () => {
    let result = parseActionReference('actions/checkout@v4', 'workflow.yml', 10)

    expect(result).toStrictEqual({
      uses: 'actions/checkout@v4',
      ref: 'actions/checkout@v4',
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

    expect(result).toStrictEqual({
      uses: 'actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65',
      ref: 'actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65',
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

    expect(result).toStrictEqual({
      uses: 'octocat/hello-world@main',
      ref: 'octocat/hello-world@main',
      name: 'octocat/hello-world',
      file: 'workflow.yml',
      type: 'external',
      version: 'main',
      line: 15,
    })
  })

  it.each(['./.github/actions/build', '../shared/actions/build'])(
    'parses the local action %s',
    reference => {
      let result = parseActionReference(reference, 'workflow.yml', 20)

      expect(result).toEqual({
        file: 'workflow.yml',
        version: undefined,
        uses: reference,
        name: reference,
        type: 'local',
        line: 20,
      })
    },
  )

  it('parses external action with subpath', () => {
    let result = parseActionReference(
      'owner/repo/path/to/action@v1',
      'workflow.yml',
      12,
    )

    expect(result).toStrictEqual({
      uses: 'owner/repo/path/to/action@v1',
      name: 'owner/repo/path/to/action',
      ref: 'owner/repo@v1',
      file: 'workflow.yml',
      type: 'external',
      version: 'v1',
      line: 12,
    })
  })

  it('keeps a repository whose name ends in .yml an external action', () => {
    let result = parseActionReference('owner/repo.yml@v1', 'workflow.yml', 14)

    expect(result).toStrictEqual({
      uses: 'owner/repo.yml@v1',
      ref: 'owner/repo.yml@v1',
      name: 'owner/repo.yml',
      file: 'workflow.yml',
      type: 'external',
      version: 'v1',
      line: 14,
    })
  })

  it('parses docker action', () => {
    let result = parseActionReference(
      'docker://alpine:3.19',
      'workflow.yml',
      25,
    )

    expect(result).toEqual({
      uses: 'docker://alpine:3.19',
      name: 'docker://alpine:3.19',
      file: 'workflow.yml',
      version: undefined,
      type: 'docker',
      line: 25,
    })
  })

  it.each([
    ['', 'empty reference'],
    [' '.repeat(3), 'whitespace-only reference'],
    ['invalid-format', 'no @ at all'],
    ['owner/repo@', 'missing version after @'],
    ['@version', 'missing owner/repo'],
    ['owner@version', 'missing repo name'],
    ['owner/@v1', 'empty repo name after the slash'],
    ['/repo@version', 'missing owner'],
    ['owner/repo/@version', 'empty segment in path'],
    ['actions/checkout@v4@main', 'more than one @'],
  ])('returns null for malformed reference: %j (%s)', reference => {
    let result = parseActionReference(reference, 'workflow.yml', 40)

    expect(result).toBeNull()
  })

  it('parses reusable workflow reference with .yml extension', () => {
    let result = parseActionReference(
      'org/repo/.github/workflows/ci.yml@v1.0.0',
      'workflow.yml',
      10,
    )

    expect(result).toStrictEqual({
      uses: 'org/repo/.github/workflows/ci.yml@v1.0.0',
      name: 'org/repo/.github/workflows/ci.yml',
      type: 'reusable-workflow',
      ref: 'org/repo@v1.0.0',
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

    expect(result).toStrictEqual({
      uses: 'org/repo/.github/workflows/ci.yaml@main',
      name: 'org/repo/.github/workflows/ci.yaml',
      type: 'reusable-workflow',
      ref: 'org/repo@main',
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

    expect(result).toStrictEqual({
      uses: 'owner/repo/path/to/workflow.yml@v2.5.0',
      name: 'owner/repo/path/to/workflow.yml',
      type: 'reusable-workflow',
      ref: 'owner/repo@v2.5.0',
      file: 'workflow.yml',
      version: 'v2.5.0',
      line: 20,
    })
  })

  it('parses reusable workflow with SHA reference', () => {
    let result = parseActionReference(
      'org/repo/.github/workflows/reusable.yml@a1b2c3d4e5f6789012345678901234567890abcd',
      'workflow.yml',
      25,
    )

    expect(result).toStrictEqual({
      uses: 'org/repo/.github/workflows/reusable.yml@a1b2c3d4e5f6789012345678901234567890abcd',
      ref: 'org/repo@a1b2c3d4e5f6789012345678901234567890abcd',
      version: 'a1b2c3d4e5f6789012345678901234567890abcd',
      name: 'org/repo/.github/workflows/reusable.yml',
      type: 'reusable-workflow',
      file: 'workflow.yml',
      line: 25,
    })
  })
})
