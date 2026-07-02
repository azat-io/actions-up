import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { printMinAgeWarning } from '../../cli/print-min-age-warning'

describe('printMinAgeWarning', () => {
  let consoleInfoSpy: MockInstance

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
  })

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
