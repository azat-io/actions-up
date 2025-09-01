import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'

import { promptUpdateSelection } from '../../core/interactive/prompt-update-selection'

interface PromptOptionsForTest {
  indicator?(state: unknown, choice: IndicatorChoice): string
  down?(): Promise<string[]>
  up?(): Promise<string[]>
  j?(): Promise<string[]>
  k?(): Promise<string[]>
  cancel?(): null
  name: string
}

interface IndicatorChoice {
  choices?: (ChoiceSeparator | ChoiceItem)[]
  isGroupLabel?: boolean
  enabled?: boolean
}

interface ChoiceItem {
  enabled?: boolean
  message?: string
  value?: string
  name?: string
}

type EnquirerPrompt = (
  options: PromptOptionsForTest,
) => Promise<{ selected: string[] }>

interface ChoiceSeparator {
  role: 'separator'
  message: string
  name?: string
}
let nextSelected: string[] = []
let capturedOptions: PromptOptionsForTest | undefined

vi.mock('enquirer', () => {
  let prompt: EnquirerPrompt = async (options: PromptOptionsForTest) => {
    capturedOptions = options

    try {
      if (typeof options.indicator === 'function') {
        options.indicator(
          {},
          {
            choices: [{ message: 'row', enabled: true, value: '0', name: '0' }],
            isGroupLabel: true,
          },
        )
        options.indicator(
          {},
          {
            choices: [
              { message: 'rowA', enabled: true, value: '0', name: '0' },
              { message: 'rowB', enabled: false, value: '1', name: '1' },
            ],
            isGroupLabel: true,
          },
        )
        options.indicator({}, { isGroupLabel: true })
        options.indicator({}, { enabled: true })
        options.indicator({}, { enabled: false })
      }
      if (typeof options.j === 'function') {
        options.down = () => Promise.resolve(['down'])
        await options.j.bind(options)()
        delete options.down
        await options.j.bind(options)()
      }
      if (typeof options.k === 'function') {
        options.up = () => Promise.resolve(['up'])
        await options.k.bind(options)()
        delete options.up
        await options.k.bind(options)()
      }
    } catch {}

    let nameKey = options.name as 'selected'
    return { [nameKey]: nextSelected }
  }
  return { default: { prompt } }
})

describe('promptUpdateSelection', () => {
  let restoreInfo: (() => void) | undefined
  let restoreLog: (() => void) | undefined

  beforeEach(() => {
    nextSelected = []
    let infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    restoreInfo = () => infoSpy.mockRestore()
    let logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    restoreLog = () => logSpy.mockRestore()
  })

  afterEach(() => {
    restoreInfo?.()
    restoreLog?.()
    restoreInfo = undefined
    restoreLog = undefined
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

    nextSelected = ['label|does-not-exist.yml']
    let selected = await promptUpdateSelection(updates)
    expect(selected).toBeNull()
  })

  it('executes prompt option callbacks (indicator/cancel/j/k)', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          file: '.github/workflows/a.yml',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
        },
        latestSha: 'abcdef1234567890',
        latestVersion: 'v4.1.0',
        currentVersion: 'v4',
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    nextSelected = []
    await promptUpdateSelection(updates)

    expect(capturedOptions).toBeTruthy()
    expect(typeof capturedOptions?.indicator).toBe('function')
    expect(typeof capturedOptions?.j).toBe('function')
    expect(typeof capturedOptions?.k).toBe('function')
    expect(typeof capturedOptions?.cancel).toBe('function')

    expect(capturedOptions?.cancel?.()).toBeNull()
  })
})
