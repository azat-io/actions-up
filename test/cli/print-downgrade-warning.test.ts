import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { printDowngradeWarning } from '../../cli/print-downgrade-warning'

describe('printDowngradeWarning', () => {
  let consoleInfoSpy: MockInstance

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
  })

  it('does nothing for empty array', () => {
    printDowngradeWarning([])

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('uses update singular for a single item', () => {
    let blocked = [
      {
        action: {
          uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo',
        },
        currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      },
    ]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '1 update that would downgrade a SHA-pinned action',
      ),
    )
  })

  it('uses updates plural for multiple items', () => {
    let blocked = [
      {
        action: {
          uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo',
        },
        currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      },
      {
        action: {
          uses: 'owner/other@99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          version: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
          name: 'owner/other',
        },
        currentVersion: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
      },
    ]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '2 updates that would downgrade SHA-pinned actions',
      ),
    )
  })

  it('explains that the latest version is older than the pinned one', () => {
    let blocked = [
      {
        action: {
          uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo',
        },
        currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      },
    ]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('older than the pinned version'),
    )
  })

  it('uses action.uses when available as identifier', () => {
    let blocked = [
      {
        action: {
          uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo',
        },
        currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      },
    ]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      ),
    )
  })

  it('falls back to name@version when uses is not set', () => {
    let blocked = [
      {
        action: {
          version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo',
        },
        currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      },
    ]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      ),
    )
  })

  it('deduplicates repeated identifiers and shows occurrence count', () => {
    let entry = {
      action: {
        uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
        version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
        name: 'owner/repo',
      },
      currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    }
    let blocked = [entry, entry, entry]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '1 update that would downgrade a SHA-pinned action',
      ),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('(×3)'))
    expect(consoleInfoSpy).toHaveBeenCalledTimes(2)
  })

  it('omits occurrence count for identifiers appearing once', () => {
    let blocked = [
      {
        action: {
          uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo',
        },
        currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
      },
    ]

    printDowngradeWarning(blocked)

    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('×'),
    )
  })
})
