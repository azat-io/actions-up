import { describe, expect, it } from 'vitest'

import { printDowngradeWarning } from '../../cli/print-downgrade-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

/**
 * SHA-pinned reference of an update that would downgrade it.
 */
interface BlockedOptions {
  /**
   * Action name.
   */
  name?: string

  /**
   * Commit SHA the reference is pinned to.
   */
  sha?: string
}

/**
 * Blocked entry in the shape the CLI hands to the printer.
 */
type BlockedUpdate = Parameters<typeof printDowngradeWarning>[0][number]

/**
 * Create an update blocked because it would downgrade a SHA-pinned action.
 *
 * @param options - Reference; `bridgecrewio/checkov-action` pinned to a SHA by
 *   default.
 * @returns Fresh blocked update.
 */
function makeBlocked({
  sha = '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
  name = 'bridgecrewio/checkov-action',
}: BlockedOptions = {}): BlockedUpdate {
  return { action: { version: sha, name }, currentVersion: sha }
}

/**
 * Second SHA-pinned action, distinct from the default one.
 *
 * @returns Fresh blocked update for `actions/checkout`.
 */
function makeBlockedCheckout(): BlockedUpdate {
  return makeBlocked({
    sha: '11bd71901bbe5b1630ceea73d27597364c9af683',
    name: 'actions/checkout',
  })
}

describe('printDowngradeWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('prints nothing when no update is blocked', () => {
    printDowngradeWarning([], false)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      expectedText:
        '\n⛔ Skipped 1 update that would downgrade a SHA-pinned action (resolved latest version is older than the pinned version, try --prefer-tags)\n' +
        '   • bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
      hint: 'suggesting --prefer-tags when tags are not preferred',
      count: 'one blocked update',
      blocked: [makeBlocked()],
      preferTags: false,
    },
    {
      expectedText:
        '\n⛔ Skipped 1 update that would downgrade a SHA-pinned action (resolved latest version is older than the pinned version)\n' +
        '   • bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
      hint: 'without the hint when tags are preferred',
      count: 'one blocked update',
      blocked: [makeBlocked()],
      preferTags: true,
    },
    {
      expectedText:
        '\n⛔ Skipped 2 updates that would downgrade SHA-pinned actions (resolved latest version is older than the pinned version, try --prefer-tags)\n' +
        '   • bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf\n' +
        '   • actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
      hint: 'suggesting --prefer-tags when tags are not preferred',
      blocked: [makeBlocked(), makeBlockedCheckout()],
      count: 'several blocked updates',
      preferTags: false,
    },
    {
      expectedText:
        '\n⛔ Skipped 2 updates that would downgrade SHA-pinned actions (resolved latest version is older than the pinned version)\n' +
        '   • bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf\n' +
        '   • actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
      hint: 'without the hint when tags are preferred',
      blocked: [makeBlocked(), makeBlockedCheckout()],
      count: 'several blocked updates',
      preferTags: true,
    },
  ])('reports $count $hint', ({ expectedText, preferTags, blocked }) => {
    printDowngradeWarning(blocked, preferTags)

    expect(consoleInfoSpy.printedText()).toBe(expectedText)
  })

  it('lists each blocked action once with the number of places it appears in', () => {
    let blocked = [makeBlocked(), makeBlockedCheckout(), makeBlocked()]

    printDowngradeWarning(blocked, false)

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⛔ Skipped 2 updates that would downgrade SHA-pinned actions (resolved latest version is older than the pinned version, try --prefer-tags)\n' +
        '   • bridgecrewio/checkov-action@99bb2caf247dfd9f03cf984373bc6043d4e32ebf (×2)\n' +
        '   • actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
    )
  })
})
