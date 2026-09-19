import { describe, expect, it } from 'vitest'

import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'
import { printModeWarning } from '../../cli/print-mode-warning'

describe('printModeWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it('does nothing for empty array', () => {
    printModeWarning([], 'patch')

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('prints warning with major/minor label when mode is patch', () => {
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

    printModeWarning(blocked, 'patch')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('major/minor'),
    )
  })

  it('prints warning with major label when mode is minor', () => {
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

    printModeWarning(blocked, 'minor')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('major'),
    )
    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('major/minor'),
    )
  })

  it('uses action singular for single blocked item', () => {
    let blocked = [
      {
        action: { name: 'actions/checkout', version: 'v3' },
        currentVersion: 'v3',
      },
    ]

    printModeWarning(blocked, 'patch')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action'),
    )
  })

  it('uses actions plural for multiple blocked items', () => {
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

    printModeWarning(blocked, 'patch')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('2 actions'),
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

    printModeWarning(blocked, 'patch')

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

    printModeWarning(blocked, 'patch')

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

    printModeWarning(blocked, 'patch')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@unknown'),
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
    let blocked = [entry, entry]

    printModeWarning(blocked, 'patch')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action due to major/minor updates'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@v3 (×2)'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledTimes(2)
  })
})
