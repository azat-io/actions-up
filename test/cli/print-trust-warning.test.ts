import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { format } from 'node:util'

import type { TrustHold } from '../../types/trust-hold'

import { printTrustWarning } from '../../cli/print-trust-warning'
import { stripAnsi } from '../../core/interactive/strip-ansi'

/**
 * Entry in the shape the CLI hands to the printer.
 */
type TrustEntry = Parameters<typeof printTrustWarning>[0][number]

const HIJACKED_SHA = '0e58ed8671d6b60d0890c21b07f8835ace038e67'

const FORK_SHA = '9c6b1b0c5a1c2d0b8f0d6e2f6a3a0c1b2d3e4f50'

const PINNED_SHA = '48d8f15b2aaa3d255ca5af3eba4870f807ce6b3c'

/**
 * Update held back because its latest tag failed a trust check.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh held-back update of `tj-actions/changed-files@v45.0.0`.
 */
function makeEntry(overrides: Partial<TrustEntry> = {}): TrustEntry {
  return {
    action: { name: 'tj-actions/changed-files', version: 'v45.0.0' },
    holdReason: 'unreachable-commit',
    trustHolds: [makeHold()],
    latestVersion: 'v45.0.7',
    ...overrides,
  }
}

/**
 * Tag held back because its commit failed a trust check.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh trust hold of `v45.0.7`.
 */
function makeHold(overrides: Partial<TrustHold> = {}): TrustHold {
  return {
    reason: 'unreachable-commit',
    version: 'v45.0.7',
    sha: HIJACKED_SHA,
    ...overrides,
  }
}

describe('printTrustWarning', () => {
  let consoleWarnSpy: MockInstance<typeof console.warn>
  let consoleInfoSpy: MockInstance<typeof console.info>

  /**
   * Text printed with `console.warn`, without colors.
   *
   * @returns Printed text, one line per call.
   */
  function printedText(): string {
    return consoleWarnSpy.mock.calls
      .map((parameters: unknown[]) => stripAnsi(format(...parameters)))
      .join('\n')
  }

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    { description: 'no entry', entries: [] },
    {
      description: 'an entry without trust holds',
      entries: [makeEntry({ trustHolds: [] })],
    },
    {
      description: 'an entry that never had a trust check fail',
      entries: [makeEntry({ trustHolds: undefined })],
    },
  ])('prints nothing for $description', ({ entries }) => {
    printTrustWarning(entries)

    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  it('names the tag, its commit and what was found, on stderr', () => {
    printTrustWarning([makeEntry()])

    expect(printedText()).toBe(
      '\n🚨 Skipped 1 tag that failed a security check. Review these repositories manually before updating:\n' +
        '   • tj-actions/changed-files@v45.0.7 → 0e58ed8: commit was found on neither the default branch nor a protected branch',
    )
    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('explains a tag that moved away from the commit a workflow pins', () => {
    printTrustWarning([
      makeEntry({
        action: { name: 'tj-actions/changed-files', version: PINNED_SHA },
        trustHolds: [makeHold({ reason: 'tag-moved' })],
        holdReason: 'tag-moved',
      }),
    ])

    expect(printedText()).toContain(
      '   • tj-actions/changed-files@v45.0.7 → 0e58ed8: tag now points at another commit than the pin',
    )
  })

  it('says which version an update that stepped down past the tag offers instead', () => {
    printTrustWarning([
      makeEntry({ latestVersion: 'v45.0.6', holdReason: undefined }),
    ])

    expect(printedText()).toContain(
      '   • tj-actions/changed-files@v45.0.7 → 0e58ed8: commit was found on neither the default branch nor a protected branch; v45.0.6 offered instead',
    )
  })

  it('warns that a workflow referencing the tag itself already runs its commit', () => {
    printTrustWarning([
      makeEntry({
        action: { name: 'tj-actions/changed-files', version: 'v45.0.7' },
      }),
    ])

    expect(printedText()).toContain(
      '   • tj-actions/changed-files@v45.0.7 → 0e58ed8: commit was found on neither the default branch nor a protected branch; the workflow already runs it',
    )
  })

  it('lists each tag once with the number of places it appears in', () => {
    printTrustWarning([
      makeEntry(),
      makeEntry(),
      makeEntry({
        action: { name: 'codfish/semantic-release-action', version: 'v1.0.0' },
        trustHolds: [makeHold({ version: 'v2.0.0', sha: FORK_SHA })],
        latestVersion: 'v2.0.0',
      }),
    ])

    expect(printedText()).toBe(
      '\n🚨 Skipped 2 tags that failed a security check. Review these repositories manually before updating:\n' +
        '   • tj-actions/changed-files@v45.0.7 → 0e58ed8: commit was found on neither the default branch nor a protected branch (×2)\n' +
        '   • codfish/semantic-release-action@v2.0.0 → 9c6b1b0: commit was found on neither the default branch nor a protected branch',
    )
  })
})
