import { afterEach, describe, expect, it, vi } from 'vitest'
import { format } from 'node:util'

import { printUntracedWarning } from '../../cli/print-untraced-warning'
import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('printUntracedWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names the file that cannot be read and the lockfile whose updates are skipped for it, on stderr', () => {
    let consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    printUntracedWarning(
      '.github/workflows/release.yml',
      '.github/workflows/actions.lock',
    )

    expect(
      consoleWarnSpy.mock.calls.map((parameters: unknown[]) =>
        stripAnsi(format(...parameters)),
      ),
    ).toStrictEqual([
      '\n⚠️  .github/workflows/release.yml cannot be read, so the updates pinned by .github/workflows/actions.lock are skipped',
    ])
  })
})
