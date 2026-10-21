import { afterEach, describe, expect, it, vi } from 'vitest'
import { format } from 'node:util'

import { printLockfileWarning } from '../../cli/print-lockfile-warning'
import { stripAnsi } from '../../core/interactive/strip-ansi'

describe('printLockfileWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says that the updates of every workflow next to a lockfile that cannot be read are skipped, on stderr', () => {
    let consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    printLockfileWarning(
      '.github/workflows/actions.lock',
      'unsupported schema version v0.0.4',
    )

    expect(
      consoleWarnSpy.mock.calls.map((parameters: unknown[]) =>
        stripAnsi(format(...parameters)),
      ),
    ).toStrictEqual([
      '\n⚠️  .github/workflows/actions.lock cannot be read (unsupported schema version v0.0.4), so the updates of every workflow next to it and of the actions they run are skipped',
    ])
  })
})
