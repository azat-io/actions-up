import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readInlineVersionComment } from '../../core/versions/read-inline-version-comment'

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}))

describe('readInlineVersionComment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns version from inline comment when present', async () => {
    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@abc # v4.2.1',
      ].join('\n'),
    )

    let result = await readInlineVersionComment('/tmp/workflow.yml', 4)
    expect(result).toBe('v4.2.1')
  })

  it('uses cached content when available', async () => {
    let { readFile } = await import('node:fs/promises')
    let cache = new Map<string, string>([
      ['/tmp/workflow.yml', '- uses: actions/checkout@abc # v2.3.4'],
    ])

    let result = await readInlineVersionComment('/tmp/workflow.yml', 1, cache)
    expect(result).toBe('v2.3.4')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('caches content when available cache is empty', async () => {
    let { readFile } = await import('node:fs/promises')
    let cache = new Map<string, string>()
    let content = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@abc # v3.0.0',
    ].join('\n')
    vi.mocked(readFile).mockResolvedValue(content)

    let result = await readInlineVersionComment('/tmp/workflow.yml', 4, cache)

    expect(result).toBe('v3.0.0')
    expect(cache.get('/tmp/workflow.yml')).toBe(content)
  })

  it('returns null when no version comment is present', async () => {
    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@abc',
      ].join('\n'),
    )

    let result = await readInlineVersionComment('/tmp/workflow.yml', 4)
    expect(result).toBeNull()
  })

  it('returns null when line number is out of range', async () => {
    let { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue('jobs:\n  build:\n')

    let result = await readInlineVersionComment('/tmp/workflow.yml', 10)
    expect(result).toBeNull()
  })
})
