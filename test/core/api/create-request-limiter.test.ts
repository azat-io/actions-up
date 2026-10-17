import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRequestLimiter } from '../../../core/api/create-request-limiter'

/**
 * Request whose outcome the test decides.
 */
interface PendingRequest {
  /**
   * Answer the request.
   */
  answer(value: string): void

  /**
   * Fail the request.
   */
  fail(error: Error): void

  /**
   * Starts the request, as the limiter calls it.
   */
  send(): Promise<string>

  /**
   * Whether the limiter started the request.
   */
  started: boolean
}

/**
 * Create a request that stays in flight until the test settles it.
 *
 * @returns Request together with the controls that settle it.
 */
function createPendingRequest(): PendingRequest {
  let { promise, resolve, reject } = Promise.withResolvers<string>()
  let request: PendingRequest = {
    send: () => {
      request.started = true
      return promise
    },
    answer: resolve,
    started: false,
    fail: reject,
  }
  return request
}

/**
 * Let every settled promise run its callbacks.
 */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('createRequestLimiter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps no more requests in flight than allowed and starts the next once one settles', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter({ maxPerMinute: 100, maxConcurrent: 2 })
    let requests = [
      createPendingRequest(),
      createPendingRequest(),
      createPendingRequest(),
    ]

    let outcomes = requests.map(request => limiter.schedule(request.send))
    await flush()

    expect(requests.map(request => request.started)).toStrictEqual([
      true,
      true,
      false,
    ])

    requests[1]!.answer('second')
    await flush()

    expect(requests[2]!.started).toBe(true)

    requests[0]!.answer('first')
    requests[2]!.answer('third')

    await expect(Promise.all(outcomes)).resolves.toStrictEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('frees the slot of a request that failed', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter({ maxPerMinute: 100, maxConcurrent: 1 })
    let failing = createPendingRequest()
    let next = createPendingRequest()
    let error = new Error('GitHub API error: 500 Internal Server Error')

    let failed = limiter.schedule(failing.send)
    let answered = limiter.schedule(next.send)
    failing.fail(error)

    await expect(failed).rejects.toBe(error)
    await flush()

    expect(next.started).toBe(true)

    next.answer('answer')

    await expect(answered).resolves.toBe('answer')
  })

  it('starts the waiting requests in the order they were scheduled', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter({ maxPerMinute: 100, maxConcurrent: 1 })
    let order: string[] = []

    await Promise.all(
      ['first', 'second', 'third'].map(name =>
        limiter.schedule(() => {
          order.push(name)
          return Promise.resolve(name)
        }),
      ),
    )

    expect(order).toStrictEqual(['first', 'second', 'third'])
  })

  it('holds requests back once the budget of the minute is spent, until the oldest start leaves the minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-03T12:00:00.000Z') })
    let limiter = createRequestLimiter({ maxConcurrent: 10, maxPerMinute: 2 })
    let started: string[] = []
    function send(name: string): () => Promise<string> {
      return () => {
        started.push(name)
        return Promise.resolve(name)
      }
    }

    await limiter.schedule(send('first'))
    await vi.advanceTimersByTimeAsync(10_000)
    await limiter.schedule(send('second'))
    let third = limiter.schedule(send('third'))
    let fourth = limiter.schedule(send('fourth'))

    await vi.advanceTimersByTimeAsync(49_999)

    expect(started).toStrictEqual(['first', 'second'])

    await vi.advanceTimersByTimeAsync(1)

    expect(started).toStrictEqual(['first', 'second', 'third'])

    await vi.advanceTimersByTimeAsync(10_000)

    await expect(Promise.all([third, fourth])).resolves.toStrictEqual([
      'third',
      'fourth',
    ])
    expect(started).toStrictEqual(['first', 'second', 'third', 'fourth'])
  })

  it('refuses the waiting and the later requests once stopped, and lets the requests in flight finish', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter({ maxPerMinute: 100, maxConcurrent: 1 })
    let inFlight = createPendingRequest()
    let waiting = createPendingRequest()
    let later = createPendingRequest()
    let rateLimit = new Error('API rate limit exceeded')

    let finished = limiter.schedule(inFlight.send)
    let refused = limiter.schedule(waiting.send)
    await flush()
    limiter.stop(rateLimit)
    limiter.stop(new Error('a second rate limit'))

    await expect(refused).rejects.toBe(rateLimit)
    await expect(limiter.schedule(later.send)).rejects.toBe(rateLimit)

    inFlight.answer('answer')

    await expect(finished).resolves.toBe('answer')
    expect([waiting.started, later.started]).toStrictEqual([false, false])
  })

  it('refuses a request whose turn came just before the limiter was stopped', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter({ maxPerMinute: 100, maxConcurrent: 1 })
    let first = createPendingRequest()
    let second = createPendingRequest()
    let rateLimit = new Error('API rate limit exceeded')

    let finished = limiter.schedule(first.send)
    let refused = limiter.schedule(second.send)
    await flush()
    first.answer('answer')
    queueMicrotask(() => {
      limiter.stop(rateLimit)
    })

    await expect(refused).rejects.toBe(rateLimit)
    await expect(finished).resolves.toBe('answer')
    expect(second.started).toBe(false)
  })

  it('tells whether it was stopped', () => {
    let limiter = createRequestLimiter()

    let before = limiter.isStopped()
    limiter.stop(new Error('API rate limit exceeded'))

    expect([before, limiter.isStopped()]).toStrictEqual([false, true])
  })

  it('refuses a request held back by the budget of the minute once stopped', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter({ maxConcurrent: 10, maxPerMinute: 1 })
    let heldBack = createPendingRequest()
    let rateLimit = new Error('API rate limit exceeded')

    await limiter.schedule(() => Promise.resolve('first'))
    let refused = limiter.schedule(heldBack.send)
    await flush()
    limiter.stop(rateLimit)

    await expect(refused).rejects.toBe(rateLimit)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(heldBack.started).toBe(false)
  })

  it('keeps six requests in flight at once by default', async () => {
    vi.useFakeTimers()
    let limiter = createRequestLimiter()
    let requests = Array.from({ length: 7 }, () => createPendingRequest())

    let outcomes = requests.map(request => limiter.schedule(request.send))
    await flush()

    expect(requests.filter(request => request.started)).toHaveLength(6)

    for (let request of requests) {
      request.answer('answer')
    }
    await Promise.all(outcomes)
  })
})
