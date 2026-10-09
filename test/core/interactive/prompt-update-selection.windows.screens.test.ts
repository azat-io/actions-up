import { afterAll, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

import type { ActionUpdate } from '../../../types/action-update'

import { promptUpdateSelection } from '../../../core/interactive/prompt-update-selection'
import { createFakeTerminal } from '../../helpers/create-fake-terminal'

/**
 * On Windows the prompt draws the symbols of Windows and leaves the last column
 * of the terminal unused. The platform is set before anything loads, since the
 * colors module decides about colors when it loads; they are forced as in the
 * other screen tests. TERM_PROGRAM is cleared because Hyper on Windows keeps
 * the usual symbols.
 */
let realPlatform = vi.hoisted(() => {
  let descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: 'win32' })
  vi.stubEnv('FORCE_COLOR', '1')
  vi.stubEnv('NO_COLOR', undefined)
  vi.stubEnv('TERM_PROGRAM', undefined)
  return descriptor
})

/**
 * Width of the terminal in which the summary of one selected action fills a
 * line exactly.
 */
const SUMMARY_WIDTH = 122

/**
 * A SHA pinned action with a patch update, which the list preselects.
 *
 * @returns The update in a list.
 */
function createUpdates(): ActionUpdate[] {
  return [
    {
      action: {
        file: path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
        uses: 'actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57',
        ref: 'actions/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57',
        version: '1bd1e32a3bdc45362d1e726936510720a7c30a57',
        name: 'actions/cache',
        comment: ' v4.2.0',
        type: 'external',
        job: 'build',
        line: 12,
      },
      currentVersion: '1bd1e32a3bdc45362d1e726936510720a7c30a57',
      latestSha: '5a3ec84eff668545956fd18022155c47e93e2684',
      targetRef: '5a3ec84eff668545956fd18022155c47e93e2684',
      latestVersion: 'v4.2.3',
      currentRefType: 'sha',
      targetRefStyle: 'sha',
      isBreaking: false,
      publishedAt: null,
      hasUpdate: true,
    },
  ]
}

/**
 * Run the selection prompt in a fake terminal below a line printed before it,
 * and take the screen at the start and once the key closes the prompt.
 *
 * @param close - Key that closes the prompt, and what it does.
 * @param close.label - What the key does.
 * @param close.key - The key as a terminal in raw mode sends it.
 * @returns The screens, and the names of the selected actions or null.
 */
async function runPrompt(close: {
  label: string
  key: string
}): Promise<{ selected: string[] | null; screens: string }> {
  let terminal = createFakeTerminal({ columns: SUMMARY_WIDTH, rows: 40 })
  console.info('Line 1 printed before the prompt')
  let selection = promptUpdateSelection(createUpdates())
  await terminal.settle()
  let initialScreen = terminal.screen()
  await terminal.press(close.key)
  let selected = await selection
  await terminal.settle()
  return {
    screens: `=== initial ===\n${initialScreen}\n\n=== ${close.label} ===\n${terminal.screen()}\n`,
    selected: selected?.map(update => update.action.name) ?? null,
  }
}

describe('promptUpdateSelection on screen on Windows', () => {
  afterAll(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
  })

  it('uses the Windows symbols and leaves a blank line after a summary that fills the width', async () => {
    let { selected, screens } = await runPrompt({
      label: 'Enter submits the selection',
      key: '\r',
    })

    await expect(screens).toMatchFileSnapshot('__screens__/windows-submit.txt')
    expect(selected).toStrictEqual(['actions/cache'])
  })

  it('marks the cancelled question with the Windows cross', async () => {
    let { selected, screens } = await runPrompt({
      label: 'Ctrl+C cancels',
      key: '\u{3}',
    })

    await expect(screens).toMatchFileSnapshot('__screens__/windows-cancel.txt')
    expect(selected).toBeNull()
  })
})
