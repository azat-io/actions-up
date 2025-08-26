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
})
