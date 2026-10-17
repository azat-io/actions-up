import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { format } from 'node:util'

import { printUnwrittenWarning } from '../../cli/print-unwritten-warning'
import { stripAnsi } from '../../core/interactive/strip-ansi'

/**
 * Unwritten entry in the shape the CLI hands to the printer.
 */
type UnwrittenUpdate = Parameters<typeof printUnwrittenWarning>[0][number]

/**
 * Create an entry the writer did not find where the scan reported it.
 *
 * @param name - Action name, pinned to `v4` on line 12 of the CI workflow.
 * @returns Fresh unwritten entry.
 */
function makeUnwritten(name = 'actions/checkout'): UnwrittenUpdate {
  return {
    action: {
      file: '.github/workflows/ci.yml',
      uses: `${name}@v4`,
      version: 'v4',
      line: 12,
      name,
    },
    currentVersion: 'v4',
  }
}

describe('printUnwrittenWarning', () => {
  let consoleErrorSpy: MockInstance<typeof console.error>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Read what the printer wrote through `console.error`.
   *
   * @returns Every call formatted the way the console formats it, joined with
   *   line breaks and stripped of ANSI colors.
   */
  function printedText(): string {
    return consoleErrorSpy.mock.calls
      .map((parameters: unknown[]) => stripAnsi(format(...parameters)))
      .join('\n')
  }

  it('prints nothing when every entry was written', () => {
    printUnwrittenWarning([], 2)

    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('lists every unwritten entry with the place the scan reported it at', () => {
    printUnwrittenWarning(
      [makeUnwritten(), makeUnwritten('actions/setup-node')],
      3,
    )

    expect(printedText()).toBe(
      '\n⚠️ Could not write 2 of 3 entries:\n' +
        '   • actions/checkout@v4 (.github/workflows/ci.yml:12)\n' +
        '   • actions/setup-node@v4 (.github/workflows/ci.yml:12)',
    )
  })

  it('uses the singular noun when a single entry was requested', () => {
    printUnwrittenWarning([makeUnwritten()], 1)

    expect(printedText()).toBe(
      '\n⚠️ Could not write 1 of 1 entry:\n' +
        '   • actions/checkout@v4 (.github/workflows/ci.yml:12)',
    )
  })

  it.each([
    {
      unwritten: {
        action: { file: '.github/workflows/ci.yml', name: 'actions/cache' },
        currentVersion: 'v3',
      },
      description: 'its name and current version without a uses reference',
      expectedEntry: '   • actions/cache@v3',
    },
    {
      unwritten: {
        action: { uses: 'actions/cache@v3', name: 'actions/cache', line: 7 },
        currentVersion: 'v3',
      },
      description: 'its reference alone without a file',
      expectedEntry: '   • actions/cache@v3',
    },
    {
      unwritten: {
        action: { name: 'actions/cache', version: null },
        currentVersion: null,
      },
      description: 'its name and an unknown version without either',
      expectedEntry: '   • actions/cache@unknown',
    },
  ])('names an entry by $description', ({ expectedEntry, unwritten }) => {
    printUnwrittenWarning([unwritten], 1)

    expect(printedText().split('\n').at(-1)).toBe(expectedEntry)
  })
})
