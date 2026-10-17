/**
 * Admits requests to the GitHub API within the limits of a run.
 */
export interface RequestLimiter {
  /**
   * Send a request once the limits allow it.
   *
   * @param send - Starts the request.
   * @returns Outcome of the request, or the error the limiter was stopped with
   *   when it was stopped before the request could start.
   */
  schedule<Value>(send: () => Promise<Value>): Promise<Value>

  /**
   * Refuse every waiting and every later request.
   *
   * Requests already in flight finish on their own.
   *
   * @param error - Error the refused requests reject with. The first error
   *   stays in force when the limiter is stopped again.
   */
  stop(error: Error): void

  /**
   * Whether the limiter was stopped.
   */
  isStopped(): boolean
}

/**
 * Limits on how a run sends its requests to the GitHub API.
 */
export interface RequestLimits {
  /**
   * Most requests in flight at once.
   */
  maxConcurrent: number

  /**
   * Most requests started within any minute.
   */
  maxPerMinute: number
}

/**
 * Request waiting for its turn.
 */
interface WaitingRequest {
  /**
   * Refuse the request without sending it.
   */
  refuse(error: Error): void

  /**
   * Let the request start.
   */
  grant(): void
}

/**
 * Length of the window `maxPerMinute` counts requests in.
 */
const MINUTE_MS = 60_000

/**
 * Limits that keep a run well inside what GitHub tolerates.
 *
 * GitHub asks integrations to avoid concurrent requests, refuses more than 100
 * of them at once, and caps REST requests at 900 points per minute, one point
 * per `GET`. A handful of requests in flight keeps a run fast while staying far
 * from the first limit, and the per-minute budget leaves headroom below the
 * second one for runs large enough to reach it.
 */
const DEFAULT_LIMITS: RequestLimits = {
  maxPerMinute: 800,
  maxConcurrent: 6,
}

/**
 * Create a limiter that admits requests in the order they were scheduled.
 *
 * @param limits - Limits to enforce.
 * @returns Limiter that holds each request back until the limits let it start.
 */
export function createRequestLimiter(
  limits: RequestLimits = DEFAULT_LIMITS,
): RequestLimiter {
  let waiting: WaitingRequest[] = []
  let recentStarts: number[] = []
  let stopError: Error | null = null
  let wakeUp: ReturnType<typeof setTimeout> | null = null
  let active = 0

  /**
   * Let as many waiting requests start as the limits allow.
   */
  function drain(): void {
    while (waiting.length > 0 && active < limits.maxConcurrent) {
      let now = Date.now()

      while (recentStarts.length > 0 && now - recentStarts[0]! >= MINUTE_MS) {
        recentStarts.shift()
      }

      if (recentStarts.length >= limits.maxPerMinute) {
        drainLater(recentStarts[0]! + MINUTE_MS - now)
        return
      }

      active += 1
      recentStarts.push(now)
      waiting.shift()!.grant()
    }
  }

  /**
   * Try again once the oldest start of the past minute has left the window.
   *
   * @param delay - Milliseconds until it leaves.
   */
  function drainLater(delay: number): void {
    wakeUp ??= setTimeout(() => {
      wakeUp = null
      drain()
    }, delay)
  }

  /**
   * Wait until a request may start.
   *
   * @returns Promise that resolves once the request holds a slot, or rejects
   *   when the limiter is stopped first.
   */
  function acquire(): Promise<void> {
    if (stopError) {
      return Promise.reject(stopError)
    }

    return new Promise<void>((resolve, reject) => {
      waiting.push({ grant: resolve, refuse: reject })
      drain()
    })
  }

  return {
    async schedule<Value>(send: () => Promise<Value>): Promise<Value> {
      await acquire()

      try {
        /**
         * The limiter can be stopped after it granted the slot but before the
         * request took it up. A request that has not started yet is refused
         * like a waiting one.
         */
        if (stopError) {
          throw stopError
        }

        return await send()
      } finally {
        active -= 1
        drain()
      }
    },

    stop(error: Error): void {
      stopError ??= error

      for (let request of waiting.splice(0)) {
        request.refuse(stopError)
      }

      if (wakeUp) {
        clearTimeout(wakeUp)
        wakeUp = null
      }
    },

    isStopped(): boolean {
      return stopError !== null
    },
  }
}
