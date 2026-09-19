import type { MockInstance, Mock } from 'vitest'

import { beforeEach, beforeAll, afterAll, vi } from 'vitest'

/**
 * Silence `console.info` for the tests of the current suite and record its
 * calls.
 *
 * Call it inside `describe`. The spy is installed when the suite starts, its
 * calls are cleared before each test, and the original method is restored when
 * the suite finishes, so a skipped suite leaves `console.info` untouched.
 *
 * @returns Mock that receives the `console.info` calls of the running test.
 */
export function spyOnConsoleInfo(): Mock<typeof console.info> {
  let calls = vi.fn<typeof console.info>()
  let spy: MockInstance<typeof console.info> | undefined

  beforeAll(() => {
    spy = vi.spyOn(console, 'info').mockImplementation(calls)
  })

  beforeEach(() => {
    calls.mockClear()
  })

  afterAll(() => {
    spy?.mockRestore()
  })

  return calls
}
