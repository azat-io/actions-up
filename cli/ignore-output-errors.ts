/**
 * Keep a failed write to standard output or standard error from ending the
 * process.
 *
 * Once the reader of the output goes away, as `head` or a pager that quits
 * does, the next write fails with `EPIPE`, and an output stream with no
 * listener for its errors ends the process. Once files are being written, that
 * would leave them updated and the lockfiles that pin them stale, so from then
 * on such errors are ignored: what is printed to an output that is gone is
 * lost, and the run goes on to its end. The listeners stay, and calling this
 * again adds none.
 */
export function ignoreOutputErrors(): void {
  for (let stream of [process.stdout, process.stderr]) {
    stream.off('error', ignoreError)
    stream.on('error', ignoreError)
  }
}

/**
 * Listener of the errors of an output stream that ignores them.
 */
function ignoreError(): void {
  /**
   * The error is dropped on purpose.
   */
}
