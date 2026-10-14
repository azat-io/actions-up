import { describe, expect, it } from 'vitest'

import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'
import { printModeWarning } from '../../cli/print-mode-warning'

/**
 * Blocked entry in the shape the CLI hands to the printer.
 */
type BlockedUpdate = Parameters<typeof printModeWarning>[0][number]

/**
 * Create an update the update mode held back.
 *
 * @param name - Action name, pinned to `v3`.
 * @returns Fresh blocked update.
 */
function makeBlocked(name = 'actions/checkout'): BlockedUpdate {
  return { action: { version: 'v3', name }, currentVersion: 'v3' }
}

describe('printModeWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('prints nothing when no action is blocked', () => {
    printModeWarning([], 'patch')

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      expectedText:
        '\n⚠️  Skipped 1 action due to major/minor updates\n' +
        '   • actions/checkout@v3',
      label: 'major and minor',
      blocked: [makeBlocked()],
      mode: 'patch' as const,
      count: 'one action',
    },
    {
      expectedText:
        '\n⚠️  Skipped 2 actions due to major/minor updates\n' +
        '   • actions/checkout@v3\n' +
        '   • actions/setup-node@v3',
      blocked: [makeBlocked(), makeBlocked('actions/setup-node')],
      label: 'major and minor',
      count: 'several actions',
      mode: 'patch' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action due to major updates\n' +
        '   • actions/checkout@v3',
      blocked: [makeBlocked()],
      mode: 'minor' as const,
      count: 'one action',
      label: 'major',
    },
    {
      expectedText:
        '\n⚠️  Skipped 2 actions due to major updates\n' +
        '   • actions/checkout@v3\n' +
        '   • actions/setup-node@v3',
      blocked: [makeBlocked(), makeBlocked('actions/setup-node')],
      count: 'several actions',
      mode: 'minor' as const,
      label: 'major',
    },
  ])(
    'reports $count blocked by $label updates in $mode mode',
    ({ expectedText, blocked, mode }) => {
      printModeWarning(blocked, mode)

      expect(consoleInfoSpy.printedText()).toBe(expectedText)
    },
  )

  it('lists each blocked action once with the number of places it appears in', () => {
    let blocked = [
      makeBlocked(),
      makeBlocked('actions/setup-node'),
      makeBlocked(),
    ]

    printModeWarning(blocked, 'patch')

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⚠️  Skipped 2 actions due to major/minor updates\n' +
        '   • actions/checkout@v3 (×2)\n' +
        '   • actions/setup-node@v3',
    )
  })
})
