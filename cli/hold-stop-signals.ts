import type { HeldSignals } from '../types/held-signals'

/**
 * Signals that stop the CLI from a terminal or a supervisor.
 */
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const

/**
 * Milliseconds after the first signal during which the next ones are held back
 * as well. Ctrl+C under `npx` or `npm run` reaches the CLI twice: the terminal
 * sends SIGINT to the whole process group, and npm passes its own on.
 */
const REPEAT_WINDOW = 1000

/**
 * Hold back SIGINT and SIGTERM from ending the process, so that the work under
 * way can finish and say what it left undone.
 *
 * The first signal is remembered, and the holding ends a second later, whether
 * or not it was released before, so that a signal after that, of either kind,
 * ends the process at once. The timer that ends it does not keep the process
 * alive.
 *
 * @returns The signal held back, and how to stop holding them.
 */
export function holdStopSignals(): HeldSignals {
  let listeners: [signal: NodeJS.Signals, listener: () => void][] = []

  /**
   * Remove the listeners, so that the next signal ends the process.
   */
  function stopHolding(): void {
    for (let [signal, listener] of listeners) {
      process.off(signal, listener)
    }
    listeners = []
  }

  let held: HeldSignals = {
    release() {
      if (held.signal === null) {
        stopHolding()
      }
    },
    signal: null,
  }

  listeners = STOP_SIGNALS.map(signal => [
    signal,
    () => {
      if (held.signal === null) {
        held.signal = signal
        setTimeout(stopHolding, REPEAT_WINDOW).unref()
      }
    },
  ])
  for (let [signal, listener] of listeners) {
    process.on(signal, listener)
  }

  return held
}
