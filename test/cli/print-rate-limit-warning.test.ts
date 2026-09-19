import { describe, expect, it } from 'vitest'

import { printRateLimitWarning } from '../../cli/print-rate-limit-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

describe('printRateLimitWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('does nothing for empty array', () => {
    printRateLimitWarning([])

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('uses update singular for a single item', () => {
    let affected = [
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
    ]

    printRateLimitWarning(affected)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('rate limited for 1 update;'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@v3'),
    )
  })

  it('uses update plural and falls back to name with version', () => {
    let affected = [
      {
        action: {
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
      {
        action: {
          name: 'actions/cache',
          version: null,
        },
        currentVersion: null,
      },
    ]

    printRateLimitWarning(affected)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('rate limited for 2 updates;'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@v3'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/cache@unknown'),
    )
  })
})
