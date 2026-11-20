import { afterEach, describe, expect, it, vi } from 'vitest'
import { format } from 'node:util'

import { printRelockNotice } from '../../cli/print-relock-notice'
import { stripAnsi } from '../../core/interactive/strip-ansi'

const COMMAND =
  'GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR="$PWD/.github/workflows" gh actions-lock --no-onboard --no-narrow -- .github/workflows/ci.yml'

describe('printRelockNotice', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Capture what the notice prints to stderr.
   *
   * @returns Reader of the printed lines, without colors.
   */
  function captureStderr(): () => string[] {
    let consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    return () =>
      consoleError.mock.calls.map((parameters: unknown[]) =>
        stripAnsi(format(...parameters)),
      )
  }

  it('lists what explains the failure and the files put back, without a command when no file keeps its updates', () => {
    let printed = captureStderr()

    printRelockNotice({
      heading:
        'gh actions-lock did not regenerate .github/workflows/actions.lock: it found problems that block the lockfile',
      details: [
        '.github/workflows/ci.yml: ref v999 does not exist (ref-missing)',
      ],
      restored: ['.github/workflows/ci.yml'],

      command: COMMAND,
      unrestored: [],
      left: [],
    })

    expect(printed()).toStrictEqual([
      '\n⚠️ gh actions-lock did not regenerate .github/workflows/actions.lock: it found problems that block the lockfile',
      '   • .github/workflows/ci.yml: ref v999 does not exist (ref-missing)',
      '   Restored 1 file to match the lockfile again:',
      '   • .github/workflows/ci.yml',
    ])
  })

  it('ends with the command that regenerates the lockfile for the files that keep their updates', () => {
    let printed = captureStderr()

    printRelockNotice({
      heading:
        'Stopped, so .github/workflows/actions.lock may not match the updated files',
      left: ['.github/workflows/ci.yml', '.github/actions/setup/action.yml'],
      command: COMMAND,
      unrestored: [],

      restored: [],
      details: [],
    })

    expect(printed()).toStrictEqual([
      '\n⚠️ Stopped, so .github/workflows/actions.lock may not match the updated files',
      '   Kept the updates in 2 files; run this to regenerate the lockfile:',
      '   • .github/workflows/ci.yml',
      '   • .github/actions/setup/action.yml',
      `   ${COMMAND}`,
    ])
  })

  it('lists the files that could not be put back apart from the ones that keep their updates', () => {
    let printed = captureStderr()

    printRelockNotice({
      unrestored: [
        '.github/workflows/ci.yml: EIO: i/o error, write',
        '.github/workflows/release.yml: ENOSPC: no space left on device, write',
      ],
      heading:
        'gh actions-lock did not regenerate .github/workflows/actions.lock: it found problems that block the lockfile',
      left: ['.github/actions/setup/action.yml'],
      restored: ['.github/workflows/lint.yml'],
      command: COMMAND,
      details: [],
    })

    expect(printed()).toStrictEqual([
      '\n⚠️ gh actions-lock did not regenerate .github/workflows/actions.lock: it found problems that block the lockfile',
      '   Restored 1 file to match the lockfile again:',
      '   • .github/workflows/lint.yml',
      '   Could not put back 2 files, which may now be cut short; check with git diff:',
      '   • .github/workflows/ci.yml: EIO: i/o error, write',
      '   • .github/workflows/release.yml: ENOSPC: no space left on device, write',
      '   Kept the updates in 1 file; run this to regenerate the lockfile:',
      '   • .github/actions/setup/action.yml',
      `   ${COMMAND}`,
    ])
  })

  it('lists the files that keep their updates without a command when running it would pin the same again', () => {
    let printed = captureStderr()

    printRelockNotice({
      details: [
        'actions/checkout@v4 is not pinned: gh actions-lock left it out of the lockfile',
      ],
      heading:
        'gh actions-lock did not pin what Actions Up checked in .github/workflows/actions.lock',
      left: ['.github/workflows/ci.yml'],
      unrestored: [],
      command: null,

      restored: [],
    })

    expect(printed()).toStrictEqual([
      '\n⚠️ gh actions-lock did not pin what Actions Up checked in .github/workflows/actions.lock',
      '   • actions/checkout@v4 is not pinned: gh actions-lock left it out of the lockfile',
      '   Kept the updates in 1 file:',
      '   • .github/workflows/ci.yml',
    ])
  })
})
