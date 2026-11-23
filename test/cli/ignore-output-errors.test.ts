import { afterEach, describe, expect, it } from 'vitest'

import { ignoreOutputErrors } from '../../cli/ignore-output-errors'

/**
 * Error a write to an output whose reader went away fails with.
 */
const BROKEN_PIPE = Object.assign(new Error('write EPIPE'), {
  syscall: 'write',
  code: 'EPIPE',
})

describe('ignoreOutputErrors', () => {
  let listeners = {
    stdout: process.stdout.listeners('error'),
    stderr: process.stderr.listeners('error'),
  }

  afterEach(() => {
    for (let name of ['stdout', 'stderr'] as const) {
      let added = process[name]
        .listeners('error')
        .filter(listener => !listeners[name].includes(listener))
      for (let listener of added) {
        process[name].off('error', listener as () => void)
      }
    }
  })

  it.each(['stdout', 'stderr'] as const)(
    'keeps a failed write to %s from ending the process, with one listener however often it is called',
    name => {
      ignoreOutputErrors()
      ignoreOutputErrors()

      expect(process[name].listeners('error')).toHaveLength(
        listeners[name].length + 1,
      )
      expect(() => process[name].emit('error', BROKEN_PIPE)).not.toThrow()
    },
  )
})
