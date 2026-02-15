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

    printSkippedWarning(skipped, false)

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

    printSkippedWarning(skipped, true)

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

    printSkippedWarning(skipped, false)

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

    printSkippedWarning(skipped, false)

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

    printSkippedWarning(skipped, false)

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

    printSkippedWarning(skipped, false)

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

    printSkippedWarning(skipped, false)

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('actions/checkout@unknown'),
    )
  })
})
