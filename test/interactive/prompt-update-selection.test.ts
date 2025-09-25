import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'

import { promptUpdateSelection } from '../../core/interactive/prompt-update-selection'
import { stripAnsi } from '../../core/interactive/strip-ansi'

interface PromptOptionsForTest {
  choices: (RenderChoiceSeparator | RenderGroupLabel | RenderChoiceItem)[]
  indicator?(state: unknown, choice: IndicatorChoice): string
  down?(): Promise<string[]>
  up?(): Promise<string[]>
  j?(): Promise<string[]>
  k?(): Promise<string[]>
  cancel?(): null
  name: string
}

interface RenderGroupLabel {
  choices: (RenderChoiceSeparator | RenderChoiceItem)[]
  isGroupLabel: boolean
  enabled?: boolean
  message: string
  value: string
  name: string
}

interface IndicatorChoice {
  choices?: (RenderChoiceSeparator | RenderChoiceItem)[]
  isGroupLabel?: boolean
  enabled?: boolean
}

interface RenderChoiceItem {
  disabled?: boolean
  enabled?: boolean
  message: string
  value: string
  name: string
}

type EnquirerPrompt = (
  options: PromptOptionsForTest,
) => Promise<{ selected: string[] }>

interface RenderChoiceSeparator {
  role: 'separator'
  message: string
  name?: string
}

function getFirstRenderedRowMessage(options: PromptOptionsForTest): string {
  let group = options.choices.find(isGroupLabel)
  if (!group) {
    throw new Error('Group label not found in choices')
  }
  let row = group.choices.find(isSelectable)
  if (!row) {
    throw new Error('Selectable row not found')
  }
  return stripAnsi(row.message)
}

function isGroupLabel(
  choice: RenderChoiceSeparator | RenderGroupLabel | RenderChoiceItem,
): choice is RenderGroupLabel {
  return (
    typeof (choice as RenderGroupLabel).isGroupLabel === 'boolean' &&
    (choice as RenderGroupLabel).isGroupLabel
  )
}

function isSelectable(
  item: RenderChoiceSeparator | RenderChoiceItem,
): item is RenderChoiceItem {
  return !('role' in item)
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

vi.mock('node:fs/promises', () => {
  let withCommentPath = '/repo/.github/workflows/ci.yml'
  let noCommentPath = '/repo/.github/workflows/no-comment.yml'
  let errorPath = '/repo/.github/workflows/error.yml'

  let withCommentContent = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: actions/checkout@e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e # v4.2.4',
    '',
  ].join('\n')

  let noCommentContent = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: actions/checkout@abc123def4567890abc123def4567890abc123de',
    '',
  ].join('\n')

  return {
    readFile: vi.fn((path: unknown) => {
      if (typeof path === 'string' && path === withCommentPath) {
        return Promise.resolve(withCommentContent)
      }
      if (typeof path === 'string' && path === noCommentPath) {
        return Promise.resolve(noCommentContent)
      }
      if (typeof path === 'string' && path === errorPath) {
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve('')
    }),
  }
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

  it('renders Current as version plus short SHA when inline comment exists, and formats Target using version diff', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          version: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e',
          file: '/repo/.github/workflows/ci.yml',
          name: 'actions/checkout',
          type: 'external',
          line: 4,
        },
        currentVersion: 'e2c02d0c8b12e4d0e8b8e0f0e0e0e0e0e0e0e0e',
        latestSha: '0400d5faaaabbbbbccccccddddeeefff11122233',
        latestVersion: 'v4.2.4',
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    nextSelected = []
    await promptUpdateSelection(updates)

    let message = getFirstRenderedRowMessage(capturedOptions!)

    expect(message).toContain('4.2.4 (e2c02d0)')
    expect(message).toMatch(/\s❯\s.*4\.2\.4 .*\(0400d5f\)/u)
  })

  it('falls back to short SHA in Current and keeps v-prefix in Target when no inline version comment', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          version: 'abc123def4567890abc123def4567890abc123de',
          file: '/repo/.github/workflows/no-comment.yml',
          name: 'actions/checkout',
          type: 'external',
          line: 4,
        },
        currentVersion: 'abc123def4567890abc123def4567890abc123de',
        latestSha: '0400d5faaaabbbbbccccccddddeeefff11122233',
        latestVersion: 'v4.2.4',
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    nextSelected = []
    await promptUpdateSelection(updates)

    let message = getFirstRenderedRowMessage(capturedOptions!)

    expect(message).toMatch(/\babc123d\b/u)
    expect(message).not.toMatch(/\(abc123d\)/u)
    expect(message).toMatch(/\s❯\s.*v4\.2\.4 .*\(0400d5f\)/u)
  })

  it('handles missing currentVersion gracefully and exercises nullish fallbacks', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          file: '/repo/.github/workflows/missing.yml',
          name: 'actions/checkout',
          type: 'external',
        },
        latestSha: '08c6903cd8c0fde910a37f88322edcfb5dd907a8',
        latestVersion: 'v3.2.1',
        currentVersion: null,
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    nextSelected = []
    await promptUpdateSelection(updates)

    let message = getFirstRenderedRowMessage(capturedOptions!)

    expect(message.toLowerCase()).toContain('unknown')
    expect(message).toMatch(/\s❯\s.*v3\.2\.1 .*\(08c6903\)/u)
  })

  it('falls back to short SHA when reading file fails (catch path)', async () => {
    let updates: ActionUpdate[] = [
      {
        action: {
          version: 'def456abc7890123def456abc7890123def456ab',
          file: '/repo/.github/workflows/error.yml',
          name: 'actions/checkout',
          type: 'external',
          line: 4,
        },
        currentVersion: 'def456abc7890123def456abc7890123def456ab',
        latestSha: '08c6903cd8c0fde910a37f88322edcfb5dd907a8',
        latestVersion: 'v4.0.1',
        isBreaking: false,
        hasUpdate: true,
      },
    ]

    nextSelected = []
    await promptUpdateSelection(updates)

    let message = getFirstRenderedRowMessage(capturedOptions!)

    expect(message).toMatch(/\bdef456a\b/u)
    expect(message).not.toMatch(/\(def456a\)/u)
    expect(message).toMatch(/\s❯\s.*v4\.0\.1 .*\(08c6903\)/u)
  })
})
