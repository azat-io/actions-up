import { describe, expect, it } from 'vitest'

import { printMinAgeWarning } from '../../cli/print-min-age-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

describe('printMinAgeWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('does nothing for empty array', () => {
    printMinAgeWarning([], 1)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('uses update and day singular for a single item and one day', () => {
    let blocked = [
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 update released less than 1 day ago'),
    )
  })

  it('uses updates and days plural for multiple items and days', () => {
    let blocked = [
      {
        action: { name: 'actions/checkout', version: 'v3' },
        currentVersion: 'v3',
      },
      {
        action: { name: 'actions/setup-node', version: 'v3' },
        currentVersion: 'v3',
      },
    ]

    printMinAgeWarning(blocked, 7)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('2 updates released less than 7 days ago'),
    )
  })

  it('mentions how to disable the cool-down', () => {
    let blocked = [
      {
        action: { name: 'actions/checkout', version: 'v3' },
        currentVersion: 'v3',
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('--min-age 0'),
    )
  })

  it('mentions how to exempt actions from the cool-down', () => {
    let blocked = [
      {
        action: { name: 'my-org/deploy', version: 'v1' },
        currentVersion: 'v1',
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('--min-age-exclude'),
    )
  })

  it('uses action.uses when available as identifier', () => {
    let blocked = [
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@v3'),
    )
  })

  it('falls back to name@version when uses is not set', () => {
    let blocked = [
      {
        action: { name: 'actions/checkout', version: 'v3' },
        currentVersion: 'v3',
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@v3'),
    )
  })

  it('deduplicates repeated identifiers and shows occurrence count', () => {
    let entry = {
      action: {
        uses: 'actions/checkout@v3',
        name: 'actions/checkout',
        version: 'v3',
      },
      currentVersion: 'v3',
    }
    let blocked = [entry, entry, entry]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 update released less than 1 day ago'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@v3 (×3)'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledTimes(2)
  })

  it('omits occurrence count for identifiers appearing once', () => {
    let blocked = [
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('×'),
    )
  })

  it('shows unknown when currentVersion is null and uses is not set', () => {
    let blocked = [
      {
        action: { name: 'actions/checkout' },
        currentVersion: null,
      },
    ]

    printMinAgeWarning(blocked, 1)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@unknown'),
    )
  })
})
