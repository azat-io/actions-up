import { describe, expect, it } from 'vitest'

import { printMinAgeWarning } from '../../cli/print-min-age-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

/**
 * Held-back entry in the shape the CLI hands to the printer.
 */
type BlockedUpdate = Parameters<typeof printMinAgeWarning>[0][number]

/**
 * Create an update the release age cool-down held back.
 *
 * @param name - Action name, pinned to `v4`.
 * @returns Fresh held-back update.
 */
function makeBlocked(name = 'actions/checkout'): BlockedUpdate {
  return { action: { version: 'v4', name }, currentVersion: 'v4' }
}

describe('printMinAgeWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('prints nothing when no update is held back', () => {
    printMinAgeWarning([], 1)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      expectedText:
        '\n⏳ Skipped 1 update released less than 1 day ago (cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)\n' +
        '   • actions/checkout@v4',
      blocked: [makeBlocked()],
      updates: 'one update',
      days: 'a single day',
      minAge: 1,
    },
    {
      expectedText:
        '\n⏳ Skipped 1 update released less than 7 days ago (cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)\n' +
        '   • actions/checkout@v4',
      blocked: [makeBlocked()],
      updates: 'one update',
      days: 'several days',
      minAge: 7,
    },
    {
      expectedText:
        '\n⏳ Skipped 2 updates released less than 1 day ago (cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)\n' +
        '   • actions/checkout@v4\n' +
        '   • actions/setup-node@v4',
      blocked: [makeBlocked(), makeBlocked('actions/setup-node')],
      updates: 'several updates',
      days: 'a single day',
      minAge: 1,
    },
    {
      expectedText:
        '\n⏳ Skipped 2 updates released less than 7 days ago (cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)\n' +
        '   • actions/checkout@v4\n' +
        '   • actions/setup-node@v4',
      blocked: [makeBlocked(), makeBlocked('actions/setup-node')],
      updates: 'several updates',
      days: 'several days',
      minAge: 7,
    },
  ])(
    'reports $updates held back for $days with how to bypass the cool-down',
    ({ expectedText, blocked, minAge }) => {
      printMinAgeWarning(blocked, minAge)

      expect(consoleInfoSpy.printedText()).toBe(expectedText)
    },
  )

  it('lists each held-back action once with the number of places it appears in', () => {
    let blocked = [
      makeBlocked(),
      makeBlocked('actions/setup-node'),
      makeBlocked(),
    ]

    printMinAgeWarning(blocked, 3)

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⏳ Skipped 2 updates released less than 3 days ago (cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)\n' +
        '   • actions/checkout@v4 (×2)\n' +
        '   • actions/setup-node@v4',
    )
  })
})
