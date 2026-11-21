import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { holdStopSignals } from '../../cli/hold-stop-signals'
import { createSpinner } from '../../cli/create-spinner'

describe('holdStopSignals', () => {
  let onSpy: MockInstance<typeof process.on>
  let offSpy: MockInstance<typeof process.off>

  /**
   * Deliver a signal to the listener held for it.
   *
   * @param signal - Signal to send.
   */
  function sendSignal(signal: NodeJS.Signals): void {
    let call = onSpy.mock.calls.find(([event]) => event === signal)!
    let listener = call[1] as () => void
    listener()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    onSpy = vi.spyOn(process, 'on').mockReturnValue(process)
    offSpy = vi.spyOn(process, 'off').mockReturnValue(process)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'holds back the first %s and the signals of the next second, even once released, then stops holding, so that the next signal ends the process',
    signal => {
      let setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      let held = holdStopSignals()

      expect(onSpy.mock.calls.map(([event]) => event)).toStrictEqual([
        'SIGINT',
        'SIGTERM',
      ])
      expect(held.signal).toBeNull()

      sendSignal(signal)
      held.release()
      sendSignal(signal)
      sendSignal(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')
      vi.advanceTimersByTime(999)

      expect(held.signal).toBe(signal)
      expect(offSpy).not.toHaveBeenCalled()
      expect(setTimeoutSpy.mock.results[0]?.value).toSatisfy(
        (timer: NodeJS.Timeout) => !timer.hasRef(),
      )

      vi.advanceTimersByTime(1)

      expect(offSpy.mock.calls).toStrictEqual(onSpy.mock.calls)
    },
  )

  it('stops holding the signals back once released', () => {
    let held = holdStopSignals()

    held.release()
    held.release()

    expect(held.signal).toBeNull()
    expect(offSpy.mock.calls).toStrictEqual(onSpy.mock.calls)
  })
})

describe('holdStopSignals over the spinner of a relock', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('holds back the copy of Ctrl+C that npm passes on, and leaves no listener a second later, so that the next signal ends the process', () => {
    vi.useFakeTimers()
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    let interrupts = process.listeners('SIGINT')
    let terminations = process.listeners('SIGTERM')

    /**
     * Deliver SIGINT to every listener the CLI added.
     */
    function interrupt(): void {
      for (let listener of process.listeners('SIGINT')) {
        if (!interrupts.includes(listener)) {
          listener('SIGINT')
        }
      }
    }

    let held = holdStopSignals()
    createSpinner('Regenerating .github/workflows/actions.lock...', {
      exitOnSignal: false,
    }).start()
    interrupt()

    expect(process.listeners('SIGINT')).toHaveLength(interrupts.length + 1)

    interrupt()
    vi.advanceTimersByTime(1000)

    expect(held.signal).toBe('SIGINT')
    expect(process.listeners('SIGINT')).toStrictEqual(interrupts)
    expect(process.listeners('SIGTERM')).toStrictEqual(terminations)
  })
})
