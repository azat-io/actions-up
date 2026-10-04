import { describe, expect, it } from 'vitest'

import { printMinAgeWarning } from '../../cli/print-min-age-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

/**
 * Reference of an update held back by the cool-down.
 */
interface BlockedOptions {
  /**
   * Version the reference is pinned to.
   */
  version?: string

  /**
   * Action name.
   */
  name?: string
}

/**
 * Held-back entry in the shape the CLI hands to the printer.
 */
type BlockedUpdate = Parameters<typeof printMinAgeWarning>[0][number]

/**
 * Create an update the release age cool-down held back.
 *
 * @param options - Reference; `actions/checkout@v4` by default.
 * @returns Fresh held-back update.
 */
function makeBlocked({
  name = 'actions/checkout',
  version = 'v4',
}: BlockedOptions = {}): BlockedUpdate {
  return { action: { version, name }, currentVersion: version }
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
      blocked: [makeBlocked(), makeBlocked({ name: 'actions/setup-node' })],
      updates: 'several updates',
      days: 'a single day',
      minAge: 1,
    },
    {
      expectedText:
        '\n⏳ Skipped 2 updates released less than 7 days ago (cool-down, use --min-age 0 to disable or --min-age-exclude to exempt actions)\n' +
        '   • actions/checkout@v4\n' +
        '   • actions/setup-node@v4',
      blocked: [makeBlocked(), makeBlocked({ name: 'actions/setup-node' })],
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
      makeBlocked({ name: 'actions/setup-node' }),
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
