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

describe('promptUpdateSelection (more cases)', () => {
  beforeEach(() => {
    nextSelected = []
  })

  it('groups into "unknown file" when file is missing', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          file: undefined,
          version: 'v4',
        },
        latestVersion: 'v4.2.4',
        currentVersion: 'v4',
        latestSha: 'sha-a',
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    nextSelected = ['0']
    let selected = await promptUpdateSelection(updates)
    expect(selected).not.toBeNull()
    expect(selected).toHaveLength(1)
    expect(selected?.[0]?.action.name).toBe('actions/cache')
  })

  it('handles non-existent group label gracefully (selects none)', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          file: '.github/workflows/a.yml',
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

    // Choose a group label that doesn't exist to hit groups.get(...) ?? []
    nextSelected = ['label|does-not-exist.yml']
    let selected = await promptUpdateSelection(updates)
    expect(selected).toBeNull()
  })
})
