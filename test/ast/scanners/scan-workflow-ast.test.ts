import { describe, expect, it, vi } from 'vitest'
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
      job: 'build',
    })
    expect(actions[1]).toMatchObject({
      name: './.github/actions/test',
      type: 'local',
      job: 'build',
    })
  })

  it('returns empty for invalid workflow structure', () => {
    let content = 'name: no-jobs\n'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, 'file.yml')
    expect(actions).toEqual([])
  })

  it('extracts job name for each action', () => {
    let content = `${[
      'name: CI',
      'on: push',
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '  test:',
      '    steps:',
      '      - uses: actions/setup-node@v4',
    ].join('\n')}\n`
    let filePath = '.github/workflows/ci.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(2)
    expect(actions[0]?.job).toBe('build')
    expect(actions[1]?.job).toBe('test')
  })

  it('handles non-scalar job key gracefully', () => {
    let warnSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    let content = `${[
      'name: CI',
      'on: push',
      'jobs:',
      '  ? [complex, key]',
      '  : steps:',
      '      - uses: actions/checkout@v4',
    ].join('\n')}\n`
    let filePath = '.github/workflows/ci.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.job).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('detects job-level uses for reusable workflows', () => {
    let content = `${[
      'name: Test',
      'on: push',
      'jobs:',
      '  call-workflow:',
      '    uses: org/repo/.github/workflows/reusable.yml@v1.0.0',
      '    with:',
      '      config: test',
    ].join('\n')}\n`
    let filePath = '.github/workflows/test.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: 'org/repo/.github/workflows/reusable.yml',
      type: 'reusable-workflow',
      job: 'call-workflow',
      version: 'v1.0.0',
      file: filePath,
    })
    expect(actions[0]?.line).toBeGreaterThan(0)
  })

  it('detects both step-level and job-level uses', () => {
    let content = `${[
      'name: Mixed',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v3',
      '      - uses: actions/setup-node@v4',
      '  call-workflow:',
      '    uses: org/repo/.github/workflows/ci.yml@v2.0.0',
      '    secrets: inherit',
    ].join('\n')}\n`
    let filePath = '.github/workflows/mixed.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(3)
    expect(actions[0]).toMatchObject({
      name: 'actions/checkout',
      type: 'external',
      version: 'v3',
      job: 'build',
    })
    expect(actions[1]).toMatchObject({
      name: 'actions/setup-node',
      type: 'external',
      version: 'v4',
      job: 'build',
    })
    expect(actions[2]).toMatchObject({
      name: 'org/repo/.github/workflows/ci.yml',
      type: 'reusable-workflow',
      job: 'call-workflow',
      version: 'v2.0.0',
    })
  })

  it('handles multiple reusable workflow calls', () => {
    let content = `${[
      'name: Multiple Reusable',
      'on: push',
      'jobs:',
      '  call-lint:',
      '    uses: org/repo/.github/workflows/lint.yml@v1',
      '  call-test:',
      '    uses: org/repo/.github/workflows/test.yaml@main',
      '  call-build:',
      '    uses: another/repo/.github/workflows/build.yml@v2.1.0',
    ].join('\n')}\n`
    let filePath = '.github/workflows/multi.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(3)
    expect(actions[0]).toMatchObject({
      name: 'org/repo/.github/workflows/lint.yml',
      type: 'reusable-workflow',
      job: 'call-lint',
      version: 'v1',
    })
    expect(actions[1]).toMatchObject({
      name: 'org/repo/.github/workflows/test.yaml',
      type: 'reusable-workflow',
      job: 'call-test',
      version: 'main',
    })
    expect(actions[2]).toMatchObject({
      name: 'another/repo/.github/workflows/build.yml',
      type: 'reusable-workflow',
      version: 'v2.1.0',
      job: 'call-build',
    })
  })

  it('handles job with only reusable workflow (no steps)', () => {
    let content = `${[
      'name: Reusable Only',
      'on: push',
      'jobs:',
      '  deploy:',
      '    uses: org/repo/.github/workflows/deploy.yml@v3.0.0',
      '    with:',
      '      environment: production',
      '    secrets: inherit',
    ].join('\n')}\n`
    let filePath = '.github/workflows/deploy.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: 'org/repo/.github/workflows/deploy.yml',
      type: 'reusable-workflow',
      version: 'v3.0.0',
      job: 'deploy',
    })
  })

  it('handles workflow with local reusable workflow reference', () => {
    let content = `${[
      'name: Local Reusable',
      'on: push',
      'jobs:',
      '  call-local:',
      '    uses: ./.github/workflows/local.yml',
    ].join('\n')}\n`
    let filePath = '.github/workflows/caller.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      name: './.github/workflows/local.yml',
      version: undefined,
      job: 'call-local',
      type: 'local',
    })
  })

  it('handles complex workflow with mixture of all types', () => {
    let content = `${[
      'name: Complex',
      'on: push',
      'jobs:',
      '  regular-job:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: docker://node:20',
      '  reusable-workflow-job:',
      '    uses: org/repo/.github/workflows/test.yml@v1.0.0',
      '  another-regular-job:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: ./.github/actions/custom',
    ].join('\n')}\n`
    let filePath = '.github/workflows/complex.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(4)
    expect(actions[0]).toMatchObject({
      name: 'actions/checkout',
      job: 'regular-job',
      type: 'external',
    })
    expect(actions[1]).toMatchObject({
      name: 'docker://node:20',
      job: 'regular-job',
      type: 'docker',
    })
    expect(actions[2]).toMatchObject({
      name: 'org/repo/.github/workflows/test.yml',
      job: 'reusable-workflow-job',
      type: 'reusable-workflow',
    })
    expect(actions[3]).toMatchObject({
      name: './.github/actions/custom',
      job: 'another-regular-job',
      type: 'local',
    })
  })

  it('handles reusable workflow uses field with invalid reference', () => {
    let content = `${[
      'name: Invalid',
      'on: push',
      'jobs:',
      '  call-invalid:',
      '    uses: invalid-reference',
    ].join('\n')}\n`
    let filePath = '.github/workflows/invalid.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toEqual([])
  })

  it('handles reusable workflow with non-scalar job key', () => {
    let warnSpy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    let content = `${[
      'name: Complex Key',
      'on: push',
      'jobs:',
      '  ? [complex, job]',
      '  : uses: org/repo/.github/workflows/test.yml@v1',
    ].join('\n')}\n`
    let filePath = '.github/workflows/complex.yml'
    let document_ = parseDocument(content)
    let actions = scanWorkflowAst(document_, content, filePath)
    expect(actions).toHaveLength(1)
    expect(actions[0]?.job).toBeUndefined()
    expect(actions[0]?.name).toBe('org/repo/.github/workflows/test.yml')
    warnSpy.mockRestore()
  })
})
