import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { isUnicodeSupported } from '../../cli/is-unicode-supported'

/**
 * Real descriptor of the platform, restored after every test.
 */
let realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

/**
 * Pretend the process runs on another platform.
 *
 * @param platform - Platform to report.
 */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('isUnicodeSupported', () => {
  beforeEach(() => {
    vi.stubEnv('TERM', 'xterm')
    vi.stubEnv('CI', undefined)
    vi.stubEnv('WT_SESSION', undefined)
    vi.stubEnv('ConEmuTask', undefined)
    vi.stubEnv('TERM_PROGRAM', undefined)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform)
    /* Cspell:disable-next-line */
    vi.unstubAllEnvs()
  })

  it('supports Unicode outside Windows', () => {
    setPlatform('darwin')

    expect(isUnicodeSupported()).toBeTruthy()
  })

  it('falls back to ASCII in the Linux console', () => {
    setPlatform('linux')
    vi.stubEnv('TERM', 'linux')

    expect(isUnicodeSupported()).toBeFalsy()
  })

  it('falls back to ASCII in a legacy Windows console', () => {
    setPlatform('win32')

    expect(isUnicodeSupported()).toBeFalsy()
  })

  it('falls back to ASCII on Windows with an empty CI', () => {
    setPlatform('win32')
    vi.stubEnv('CI', '')

    expect(isUnicodeSupported()).toBeFalsy()
  })

  it.each([
    ['CI', 'true'],
    ['WT_SESSION', '1'],
    ['ConEmuTask', '{cmd::Cmder}'],
    ['TERM_PROGRAM', 'vscode'],
    ['TERM', 'xterm-256color'],
    ['TERM', 'alacritty'],
  ])('supports Unicode on Windows when %s is %s', (name, value) => {
    setPlatform('win32')
    vi.stubEnv(name, value)

    expect(isUnicodeSupported()).toBeTruthy()
  })
})
