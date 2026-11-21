import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'

import { applyRequestedUpdates } from '../../cli/apply-requested-updates'
import { makeWorkflowLockfile } from '../helpers/make-workflow-lockfile'
import { regenerateLockfiles } from '../../cli/regenerate-lockfiles'
import { writeUpdates } from '../../core/ast/update/apply-updates'
import { stripAnsi } from '../../core/interactive/strip-ansi'

vi.mock(import('../../core/ast/update/apply-updates'))
vi.mock(import('../../cli/regenerate-lockfiles'))

const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

const RELEASE_WORKFLOW = '/repo/.github/workflows/release.yml'

/**
 * Lockfile of `/repo` that tracks the CI workflow.
 */
const LOCKED_FILES = new Map([
  [
    CI_WORKFLOW,
    [
      {
        workflows: ['.github/workflows/ci.yml'],
        lockfile: makeWorkflowLockfile(),
      },
    ],
  ],
])

/**
 * Create an update of a workflow to apply.
 *
 * @param file - Workflow of the update.
 * @param locked - Whether a workflow lockfile pins it.
 * @returns Update of `actions/checkout` from `v3` to `v4`.
 */
function makeUpdate(file: string, locked: boolean): ActionUpdate {
  return {
    action: {
      name: 'actions/checkout',
      type: 'external',
      version: 'v3',
      locked,
      file,
    },
    latestSha: '11d5960a326750d5838078e36cf38b85af677262',
    targetRefStyle: 'tag',
    currentVersion: 'v3',
    latestVersion: 'v4',
    publishedAt: null,
    isBreaking: true,
    hasUpdate: true,
    targetRef: 'v4',
    status: 'ok',
  }
}

describe('applyRequestedUpdates', () => {
  let consoleInfoSpy: MockInstance<typeof console.info>
  let consoleErrorSpy: MockInstance<typeof console.error>

  /**
   * Text printed with `console.info` and `console.error`, without colors and
   * surrounding line breaks.
   *
   * @returns Printed entries, in the order of the two streams.
   */
  function printed(): string[] {
    return [...consoleInfoSpy.mock.calls, ...consoleErrorSpy.mock.calls].map(
      ([text]) => stripAnsi(String(text)).replaceAll(/^\n+|\n+$/gu, ''),
    )
  }

  beforeEach(() => {
    vi.resetAllMocks()
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(regenerateLockfiles).mockResolvedValue({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
  })

  afterEach(() => {
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('regenerates the lockfiles of the written updates and reports success', async () => {
    let locked = makeUpdate(CI_WORKFLOW, true)
    let files = [{ before: 'before\n', path: CI_WORKFLOW, after: 'after\n' }]
    vi.mocked(writeUpdates).mockResolvedValue({ unwritten: [], files })

    await applyRequestedUpdates(
      [locked, makeUpdate(RELEASE_WORKFLOW, false)],
      LOCKED_FILES,
    )

    expect(regenerateLockfiles).toHaveBeenCalledExactlyOnceWith(
      [expect.objectContaining({ updates: [locked] })],
      files,
      expect.objectContaining({ signal: null }),
    )
    expect(printed()).toStrictEqual(['✓ Updates applied successfully!'])
    expect(process.exitCode).toBeUndefined()
  })

  it('counts the entries of a file put back as not applied, names the signal that stopped the run, and ends with its code', async () => {
    let updates = [
      makeUpdate(CI_WORKFLOW, true),
      makeUpdate(RELEASE_WORKFLOW, false),
    ]
    vi.mocked(writeUpdates).mockResolvedValue({ unwritten: [], files: [] })
    vi.mocked(regenerateLockfiles).mockImplementation(
      (_targets, _written, signals) => {
        signals.signal = 'SIGTERM'
        return Promise.resolve({
          restored: new Set([CI_WORKFLOW]),
          unrestored: new Set(),
          exitCode: 143,
        })
      },
    )

    await applyRequestedUpdates(updates, LOCKED_FILES)

    expect(printed()).toStrictEqual([
      '✓ 1 of 2 entries applied',
      '⚠️ Interrupted by SIGTERM',
    ])
    expect(process.exitCode).toBe(143)
  })

  it('stops holding signals back when the writes fail', async () => {
    let listeners = process.listeners('SIGINT')
    vi.mocked(writeUpdates).mockRejectedValue(new Error('EROFS'))

    await expect(
      applyRequestedUpdates([makeUpdate(CI_WORKFLOW, true)], LOCKED_FILES),
    ).rejects.toThrow('EROFS')

    expect(process.listeners('SIGINT')).toStrictEqual(listeners)
    expect(regenerateLockfiles).not.toHaveBeenCalled()
  })
})
