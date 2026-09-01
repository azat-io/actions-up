import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { printSkippedWarning } from '../../cli/print-skipped-warning'

describe('printSkippedWarning', () => {
  let consoleInfoSpy: MockInstance

  beforeEach(() => {
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
  })

  it('prints hint about --include-branches when includeBranches is false', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'main' },
        currentVersion: 'main',
      },
    ]

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('--include-branches'),
    )
  })

  it('omits hint when includeBranches is true', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'main' },
        currentVersion: 'main',
      },
    ]

    printSkippedWarning(skipped, true, 'sha')

    expect(consoleInfoSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('--include-branches'),
    )
  })

  it('uses action singular for single skipped item', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'main' },
        currentVersion: 'main',
      },
    ]

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action'),
    )
  })

  it('uses actions plural for multiple skipped items', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'main' },
        currentVersion: 'main',
      },
      {
        action: { name: 'actions/setup-node', version: 'main' },
        currentVersion: 'main',
      },
    ]

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('2 actions'),
    )
  })

  it('uses action.uses as identifier when available', () => {
    let skipped = [
      {
        action: {
          uses: 'actions/checkout@main',
          name: 'actions/checkout',
          version: 'main',
        },
        currentVersion: 'main',
      },
    ]

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@main'),
    )
  })

  it('falls back to name@version when uses is not set', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'main' },
        currentVersion: 'main',
      },
    ]

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@main'),
    )
  })

  it('shows unknown when currentVersion is null and uses is not set', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout' },
        currentVersion: null,
      },
    ]

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@unknown'),
    )
  })

  it('prints a dedicated warning for refs that cannot be preserved', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'stable' },
        skipReason: 'unsupported-style' as const,
        currentVersion: 'stable',
      },
    ]

    printSkippedWarning(skipped, true, 'preserve')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not be preserved'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@stable'),
    )
  })

  it('prints a generic warning for unsupported style skips outside preserve mode', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'stable' },
        skipReason: 'unsupported-style' as const,
        currentVersion: 'stable',
      },
    ]

    printSkippedWarning(skipped, true, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('current style'),
    )
  })

  it('reports skip reasons that have no dedicated group', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'stable' },
        skipReason: 'unknown' as const,
        currentVersion: 'stable',
      },
    ]

    printSkippedWarning(skipped, true, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not be checked'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@stable'),
    )
  })

  it('keeps unrelated skip reasons in their own groups', () => {
    let skipped = [
      {
        action: { name: 'actions/checkout', version: 'main' },
        skipReason: 'branch' as const,
        currentVersion: 'main',
      },
      {
        action: { name: 'actions/cache', version: 'stable' },
        skipReason: 'unsupported-style' as const,
        currentVersion: 'stable',
      },
      {
        action: { name: 'actions/setup-node', version: 'latest' },
        skipReason: 'unknown' as const,
        currentVersion: 'latest',
      },
    ]

    printSkippedWarning(skipped, true, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action pinned to branches'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action that could not be updated'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action that could not be checked'),
    )
  })

  it('deduplicates repeated identifiers and shows occurrence count', () => {
    let entry = {
      action: { name: 'actions/checkout', version: 'main' },
      currentVersion: 'main',
    }
    let skipped = [entry, entry]

    printSkippedWarning(skipped, true, 'sha')

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 action pinned to branches'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@main (×2)'),
    )
    expect(consoleInfoSpy).toHaveBeenCalledTimes(2)
  })
})
