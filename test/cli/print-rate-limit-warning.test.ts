import { describe, expect, it } from 'vitest'

import { printRateLimitWarning } from '../../cli/print-rate-limit-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

/**
 * Reference of an update whose tag validation was rate limited.
 */
interface AffectedOptions {
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
 * Affected entry in the shape the CLI hands to the printer.
 */
type AffectedUpdate = Parameters<typeof printRateLimitWarning>[0][number]

/**
 * Create an update that fell back to an exact version under the rate limit.
 *
 * @param options - Reference; `actions/checkout@v4` by default.
 * @returns Fresh affected update.
 */
function makeAffected({
  name = 'actions/checkout',
  version = 'v4',
}: AffectedOptions = {}): AffectedUpdate {
  return { action: { version, name }, currentVersion: version }
}

describe('printRateLimitWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('prints nothing when no update was rate limited', () => {
    printRateLimitWarning([])

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('uses the plural noun for several rate-limited updates', () => {
    printRateLimitWarning([
      makeAffected(),
      makeAffected({ name: 'actions/setup-node' }),
    ])

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⚠️ Tag validation was rate limited for 2 updates; exact versions were written instead of floating tags\n' +
        '   • actions/checkout@v4\n' +
        '   • actions/setup-node@v4',
    )
  })

  /**
   * `action.version` is left out of the first two rows, so the printed version
   * can only come from the field each row is about.
   */
  it.each([
    {
      expectedText:
        '\n⚠️ Tag validation was rate limited for 1 update; exact versions were written instead of floating tags\n' +
        '   • actions/checkout@v4',
      affected: {
        action: { uses: 'actions/checkout@v4', name: 'actions/checkout' },
        currentVersion: 'v4.2.2',
      },
      description: 'its uses reference',
    },
    {
      expectedText:
        '\n⚠️ Tag validation was rate limited for 1 update; exact versions were written instead of floating tags\n' +
        '   • actions/setup-node@v4',
      affected: {
        action: { name: 'actions/setup-node' },
        currentVersion: 'v4',
      },
      description: 'its name and current version without a uses reference',
    },
    {
      expectedText:
        '\n⚠️ Tag validation was rate limited for 1 update; exact versions were written instead of floating tags\n' +
        '   • actions/cache@unknown',
      affected: {
        action: { name: 'actions/cache', version: null },
        currentVersion: null,
      },
      description: 'its name and an unknown version without either',
    },
  ])(
    'reports one rate-limited update by $description',
    ({ expectedText, affected }) => {
      printRateLimitWarning([affected])

      expect(consoleInfoSpy.printedText()).toBe(expectedText)
    },
  )
})
