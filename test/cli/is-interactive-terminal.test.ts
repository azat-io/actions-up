import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { isatty } from 'node:tty'

import { isInteractiveTerminal } from '../../cli/is-interactive-terminal'

vi.mock(import('node:tty'), () => ({ isatty: vi.fn() }))

describe('isInteractiveTerminal', () => {
  beforeEach(() => {
    vi.mocked(isatty).mockReturnValue(true)
    vi.stubEnv('TERM', 'xterm-256color')
    vi.stubEnv('CI', undefined)
  })

  afterEach(() => {
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
  })

  it('accepts a terminal on standard output', () => {
    expect(isInteractiveTerminal()).toBeTruthy()
    expect(isatty).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('rejects standard output that is not a terminal', () => {
    vi.mocked(isatty).mockReturnValue(false)

    expect(isInteractiveTerminal()).toBeFalsy()
  })

  it('rejects a dumb terminal', () => {
    vi.stubEnv('TERM', 'dumb')

    expect(isInteractiveTerminal()).toBeFalsy()
  })

  it('rejects CI, even when the variable is empty', () => {
    vi.stubEnv('CI', '')

    expect(isInteractiveTerminal()).toBeFalsy()
  })
})
