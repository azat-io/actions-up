/**
 * Stop signal held back from ending the process.
 */
export interface HeldSignals {
  /**
   * The first SIGINT or SIGTERM since the signals were held back, null while
   * none arrived.
   */
  signal: 'SIGTERM' | 'SIGINT' | null

  /**
   * Stop holding the signals back, so that the next one ends the process. Once
   * a signal arrived, the holding ends on its own a second after it instead.
   */
  release(): void
}
