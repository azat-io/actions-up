import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../../types/action-update'

import { applyUpdates } from '../../../core/ast/update/apply-updates'

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
}))

describe('applyUpdates', () => {
  function assertString(value: unknown): asserts value is string {
    if (typeof value !== 'string') {
      throw new TypeError('Expected value to be a string')
    }
  }
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaces unquoted uses with SHA and adds tag comment', async () => {
    let filePath = '/repo/.github/workflows/ci.yml'
    let original = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v1',
      '      - run: echo "hi"',
      '',
    ].join('\n')

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let sha = 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e0'

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v1',
        },
        latestVersion: 'v4.2.0',
        currentVersion: 'v1',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
        latestSha: sha,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    let updated = content
    expect(updated).toContain(`- uses: actions/checkout@${sha} # v4.2.0`)
  })

  it('replaces single-quoted uses preserving quotes', async () => {
    let filePath = '/repo/.github/workflows/build.yml'
    let original = ['steps:', `  - uses: 'actions/cache@v3'`, ''].join('\n')

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let sha = 'abc123def4567890abc123def4567890abc123de'

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          file: filePath,
          version: 'v3',
        },
        latestVersion: 'v3.1.2',
        currentVersion: 'v3',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
        latestSha: sha,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    let updated = content
    expect(updated).toContain(`- uses: 'actions/cache@${sha}' # v3.1.2`)
  })

  it('preserves comment on next line with CRLF endings', async () => {
    let filePath = '/repo/.github/workflows/comment-crlf.yml'
    let original = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v2',
      '      # keep me',
      '      - run: echo "done"',
      '',
    ].join('\r\n')

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v2',
        },
        latestSha: '0123456789abcdef0123456789abcdef01234567',
        latestVersion: 'v4.2.0',
        currentVersion: 'v2',
        publishedAt: null,
        isBreaking: true,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    expect(content).toContain(
      '- uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 # v4.2.0\r\n      # keep me',
    )
  })

  it('replaces double-quoted uses and overwrites existing trailing comment', async () => {
    let filePath = '/repo/.github/workflows/node.yml'
    let original = [
      'steps:',
      `  - uses: "actions/setup-node@v5" # old comment`,
      '',
    ].join('\n')

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let sha = 'f1f2f3f4f5f6f7f8f9f0a1a2a3a4a5a6a7a8a9b0'

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/setup-node',
          type: 'external',
          file: filePath,
          version: 'v5',
        },
        latestVersion: 'v5.1.0',
        currentVersion: 'v5',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
        latestSha: sha,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    let updated = content
    expect(updated).toContain(`- uses: "actions/setup-node@${sha}" # v5.1.0`)
    expect(updated).not.toContain('old comment')
  })

  it('applies multiple updates within the same file', async () => {
    let filePath = '/repo/.github/workflows/multi.yml'
    let original = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v2',
      '      - uses: "actions/setup-node@v4"',
      '',
    ].join('\n')

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v2',
        },
        latestSha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        latestVersion: 'v4.2.0',
        currentVersion: 'v2',
        publishedAt: null,
        isBreaking: true,
        hasUpdate: true,
      },
      {
        action: {
          name: 'actions/setup-node',
          type: 'external',
          file: filePath,
          version: 'v4',
        },
        latestSha: 'ffffffffffffffffffffffffffffffffffffffff',
        latestVersion: 'v5.0.1',
        currentVersion: 'v4',
        publishedAt: null,
        isBreaking: true,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    let updated = content
    expect(updated).toContain(
      '- uses: actions/checkout@eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee # v4.2.0',
    )
    expect(updated).toContain(
      '- uses: "actions/setup-node@ffffffffffffffffffffffffffffffffffffffff" # v5.0.1',
    )
  })

  it('handles actions with overlapping version prefixes without duplicating suffix in comment', async () => {
    let filePath = '/repo/.github/workflows/prefix.yml'
    let original = [
      'name: deploy',
      'on:',
      '  push:',
      '',
      'jobs:',
      '  build:',
      '    name: build',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: checkout',
      '        uses: actions/checkout@v3',
      '',
      '  publish_typescript_sdk:',
      '    runs-on: ubuntu-latest',
      '    name: publish typescript sdk',
      '    steps:',
      '      - id: checkout',
      '        name: Checkout',
      '        uses: actions/checkout@v3.0.2',
      '',
    ].join('\n')

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let sha = '08c6903cd8c0fde910a37f88322edcfb5dd907a8'

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v3',
        },
        latestVersion: 'v5.0.0',
        currentVersion: 'v3',
        publishedAt: null,
        isBreaking: true,
        hasUpdate: true,
        latestSha: sha,
      },
      {
        action: {
          name: 'actions/checkout',
          version: 'v3.0.2',
          type: 'external',
          file: filePath,
        },
        currentVersion: 'v3.0.2',
        latestVersion: 'v5.0.0',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
        latestSha: sha,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    expect(content).toContain(`uses: actions/checkout@${sha} # v5.0.0`)
    expect(content).not.toContain('# v5.0.0.0.2')
  })

  it('skips updates without latestSha', async () => {
    let filePath = '/repo/.github/workflows/skip.yml'
    let original = `uses: actions/checkout@v3\n`

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/checkout',
          type: 'external',
          file: filePath,
          version: 'v3',
        },
        latestVersion: 'v4.2.0',
        currentVersion: 'v3',
        isBreaking: false,
        publishedAt: null,
        latestSha: null,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    expect(content).toBe(original)
  })

  it('handles missing currentVersion by matching bare @ and replacing, leaving original suffix', async () => {
    let filePath = '/repo/.github/workflows/missing-version.yml'
    let original = `steps:\n  - uses: actions/cache@v3\n`

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          file: filePath,
          version: null,
        },
        latestSha: '1234567890abcdef1234567890abcdef12345678',
        latestVersion: 'v3.1.5',
        currentVersion: null,
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    expect(content).toContain(
      '  - uses: actions/cache@1234567890abcdef1234567890abcdef12345678 # v3.1.5v3',
    )
  })

  it('skips update when action name contains newline and logs error', async () => {
    let filePath = '/repo/.github/workflows/invalid-name.yml'
    let original = `steps:\n  - uses: actions/cache@v3\n`

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        typeof path === 'string' && path === filePath ? original : '',
      ),
    )

    let consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache\nmalformed',
          type: 'external',
          file: filePath,
          version: 'v3',
        },
        latestSha: '1234567890abcdef1234567890abcdef12345678',
        latestVersion: 'v3.1.5',
        currentVersion: 'v3',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledOnce()
    let [, content] = vi.mocked(writeFile).mock.calls[0]!
    assertString(content)
    expect(content).toBe(original)
    expect(consoleSpy).toHaveBeenCalledWith(
      'Invalid action name: actions/cache\nmalformed',
    )
  })

  it('skips update when file path is missing', async () => {
    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue('')

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          file: undefined,
          version: 'v3',
        },
        latestSha: '1234567890abcdef1234567890abcdef12345678',
        latestVersion: 'v3.1.5',
        currentVersion: 'v3',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('logs error when current version contains newline', async () => {
    let filePath = '/repo/.github/workflows/invalid-version.yml'
    let original = `steps:\n  - uses: actions/cache@v3\n`

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(original)

    let consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          version: 'v3\n',
          file: filePath,
        },
        latestSha: '1234567890abcdef1234567890abcdef12345678',
        latestVersion: 'v3.1.5',
        currentVersion: 'v3\n',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledWith(filePath, original, 'utf8')
    expect(consoleSpy).toHaveBeenCalledWith('Invalid version: v3\n')
  })

  it('logs error when latest SHA has invalid format', async () => {
    let filePath = '/repo/.github/workflows/invalid-sha.yml'
    let original = `steps:\n  - uses: actions/cache@v3\n`

    let { writeFile, readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValue(original)

    let consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          file: filePath,
          version: 'v3',
        },
        latestVersion: 'v3.1.5',
        latestSha: 'not-a-sha',
        currentVersion: 'v3',
        isBreaking: false,
        publishedAt: null,
        hasUpdate: true,
      },
    ]

    await applyUpdates(updates)

    expect(writeFile).toHaveBeenCalledWith(filePath, original, 'utf8')
    expect(consoleSpy).toHaveBeenCalledWith('Invalid SHA format: not-a-sha')
  })
})
