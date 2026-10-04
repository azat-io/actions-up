import type { MockInstance, Mock } from 'vitest'

import { beforeEach, afterEach, vi } from 'vitest'
import { format } from 'node:util'

import { stripAnsi } from '../../core/interactive/strip-ansi'

/**
 * Mock that receives the `console.info` calls of the running test.
 */
interface ConsoleInfoSpy extends Mock<typeof console.info> {
  /**
   * Read what the running test printed through `console.info`.
   *
   * @returns Every call formatted the way the console formats it, joined with
   *   line breaks and stripped of ANSI colors.
   */
  printedText(): string
}

/**
 * Silence `console.info` for the tests of the current suite and record its
 * calls.
 *
 * Call it inside `describe`. The spy is installed before each test and the
 * original method is restored after it, so a `vi.restoreAllMocks()` in one test
 * cannot unhook the spy for the next one, and a skipped suite leaves
 * `console.info` untouched.
 *
 * @returns Mock that receives the `console.info` calls of the running test.
 */
export function spyOnConsoleInfo(): ConsoleInfoSpy {
  let calls = vi.fn<typeof console.info>()
  let spy: MockInstance<typeof console.info> | undefined

  beforeEach(() => {
    calls.mockClear()
    spy = vi.spyOn(console, 'info').mockImplementation(calls)
  })

  afterEach(() => {
    spy?.mockRestore()
    spy = undefined
  })

  return Object.assign(calls, {
    printedText(): string {
      return calls.mock.calls
        .map((parameters: unknown[]) => stripAnsi(format(...parameters)))
        .join('\n')
    },
  })
}
