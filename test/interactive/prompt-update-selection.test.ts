import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'

import { promptUpdateSelection } from '../../core/interactive/prompt-update-selection'

type EnquirerPrompt = (options: {
  name: string
}) => Promise<{ selected: string[] }>
let nextSelected: string[] = []

vi.mock('enquirer', () => {
  let prompt: EnquirerPrompt = (options: { name: string }) =>
    Promise.resolve({ [options.name]: nextSelected }) as unknown as Promise<{
      selected: string[]
    }>
  return { default: { prompt } }
})

describe('promptUpdateSelection', () => {
  beforeEach(() => {
    nextSelected = []
  })

  it('returns null when there are no updates', async () => {
    let result = await promptUpdateSelection([])
    expect(result).toBeNull()
  })

  it('expands a selected group label into all selectable rows', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          file: '.github/actions/a.yml',
          name: 'actions/cache',
          type: 'external',
          version: 'v4',
        },
        latestVersion: 'v4.2.4',
        currentVersion: 'v4',
        latestSha: 'sha-a',
        isBreaking: false,
        hasUpdate: true,
      },
      {
        action: {
          file: '.github/actions/a.yml',
          name: 'actions/setup-node',
          type: 'external',
          version: 'v4',
        },
        latestVersion: 'v5.0.0',
        currentVersion: 'v4',
        isBreaking: true,
        latestSha: null,
        hasUpdate: true,
      },
      {
        action: {
          file: '.github/workflows/b.yml',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
        },
        latestVersion: 'v4.1.0',
        currentVersion: 'v4',
        latestSha: 'sha-b',
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    // Select first group label (relative to .github => 'actions/a.yml')
    nextSelected = ['label|actions/a.yml']
    let selected = await promptUpdateSelection(updates)

    expect(selected).not.toBeNull()
    expect(selected).toHaveLength(1)
    expect(selected?.[0]?.action.name).toBe('actions/cache')
  })

  it('maps numeric selections to updates by index and ignores disabled', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          file: '.github/actions/a.yml',
          name: 'actions/cache',
          type: 'external',
          version: 'v4',
        },
        latestVersion: 'v4.2.4',
        currentVersion: 'v4',
        latestSha: 'sha-a',
        isBreaking: false,
        hasUpdate: true,
      },
      {
        action: {
          file: '.github/actions/a.yml',
          name: 'actions/setup-node',
          type: 'external',
          version: 'v4',
        },
        latestVersion: 'v5.0.0',
        currentVersion: 'v4',
        isBreaking: true,
        latestSha: null,
        hasUpdate: true,
      },
    ]

    nextSelected = ['0', '1']
    let selected = await promptUpdateSelection(updates)
    expect(selected).not.toBeNull()
    expect(selected).toHaveLength(1)
    expect(selected?.[0]?.action.name).toBe('actions/cache')
  })
})
