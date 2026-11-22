import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

import type { RelockResult } from '../../types/relock-result'
import type { RelockTarget } from '../../types/relock-target'
import type { ActionUpdate } from '../../types/action-update'
import type { HeldSignals } from '../../types/held-signals'
import type { WrittenFile } from '../../types/written-file'
import type { Spinner } from '../../cli/create-spinner'
import type { LockPin } from '../../types/lock-pin'

import { restoreWrittenFiles } from '../../core/fs/restore-written-files'
import { makeWorkflowLockfile } from '../helpers/make-workflow-lockfile'
import { relockWorkflows } from '../../core/lockfile/relock-workflows'
import { regenerateLockfiles } from '../../cli/regenerate-lockfiles'
import { printRelockNotice } from '../../cli/print-relock-notice'
import { makeLockfileText } from '../helpers/make-lockfile-text'

let { createSpinnerMock, spinnerMock } = vi.hoisted(() => {
  let spinner: Spinner = {
    success: vi.fn<Spinner['success']>(),
    error: vi.fn<Spinner['error']>(),
    start: vi.fn(() => spinner),
  }
  return { createSpinnerMock: vi.fn(() => spinner), spinnerMock: spinner }
})

vi.mock(import('../../cli/create-spinner'), () => ({
  createSpinner: createSpinnerMock,
}))
vi.mock(
  import('../../core/lockfile/relock-workflows'),
  async importOriginal => ({
    ...(await importOriginal()),
    relockWorkflows: vi.fn(),
  }),
)
vi.mock(import('../../core/fs/restore-written-files'))
vi.mock(import('../../cli/print-relock-notice'))
vi.mock(import('node:fs/promises'), () => ({ readFile: vi.fn() }))

const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

const RELEASE_WORKFLOW = '/repo/.github/workflows/release.yml'

const SETUP_ACTION = '/repo/.github/actions/setup/action.yml'

const VENDORED_WORKFLOW = '/repo/vendor/tool/.github/workflows/ci.yml'

/**
 * Commit `v4` of `actions/checkout` points at, which the plan checked.
 */
const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262'

/**
 * Commit an earlier relock recorded for `actions/checkout@v4`.
 */
const RECORDED_SHA = '11bd71901bbe5b1630ceea73d27597364c9af683'

const CACHE_SHA = 'caa296126883cff596d87d8935842f9db880ef25'

const SETUP_NODE_SHA = 'a0853c24544627f65ddf259abe73b1d18a591444'

const COMMAND =
  'GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows gh actions-lock --no-onboard --no-narrow -- .github/workflows/ci.yml .github/workflows/release.yml'

const VENDORED_COMMAND =
  '(cd -P ./vendor/tool && GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows gh actions-lock --no-onboard --no-narrow -- .github/workflows/ci.yml)'

/**
 * Lockfile of `/repo` that tracks the CI and release workflows, which both run
 * the setup action of the repository through `$/`.
 */
const LOCKFILE = makeWorkflowLockfile({
  reached: new Map([
    [
      SETUP_ACTION,
      new Map([
        [RELEASE_WORKFLOW, true],
        [CI_WORKFLOW, true],
      ]),
    ],
  ]),
  keys: new Map([
    ['.github/workflows/release.yml', RELEASE_WORKFLOW],
    ['.github/workflows/ci.yml', CI_WORKFLOW],
  ]),
  workflows: new Set([RELEASE_WORKFLOW, CI_WORKFLOW]),
})

/**
 * Lockfile of a repository vendored into `/repo`.
 */
const VENDORED = makeWorkflowLockfile({
  keys: new Map([['.github/workflows/ci.yml', VENDORED_WORKFLOW]]),
  path: '/repo/vendor/tool/.github/workflows/actions.lock',
  workflows: new Set([VENDORED_WORKFLOW]),
  root: '/repo/vendor/tool',
})

/**
 * Create a written update of a locked action.
 *
 * @param file - File the update was written to.
 * @param checked - Reference written and the commit the plan checked for it.
 * @returns Update the writer wrote.
 */
function makeUpdate(file: string, checked: LockPin): ActionUpdate {
  return {
    action: {
      name: checked.repository,
      type: 'external',
      version: 'v3',
      locked: true,
      file,
    },
    latestSha: checked.sha,
    targetRef: checked.ref,
    targetRefStyle: 'tag',
    currentVersion: 'v3',
    latestVersion: 'v9',
    publishedAt: null,
    isBreaking: true,
    hasUpdate: true,
    status: 'ok',
  }
}

/**
 * Pin of a regenerated lockfile.
 *
 * @param repository - Repository, `owner/repo`.
 * @param reference - Reference, as the workflow names it.
 * @param sha - Commit.
 * @returns What the lockfile records for the reference.
 */
function makePin(repository: string, reference: string, sha: string): LockPin {
  return { ref: reference, repository, sha }
}

/**
 * What the regenerated lockfile of `/repo` pins when it pins what was checked.
 */
const TARGET_PINS = [
  makePin('actions/checkout', 'v4', CHECKOUT_SHA),
  makePin('actions/cache', 'v5', CACHE_SHA),
]

/**
 * Target that relocks both tracked workflows of `/repo` for the written CI
 * workflow and setup action.
 */
const TARGET: RelockTarget = {
  files: new Map([
    [
      SETUP_ACTION,
      ['.github/workflows/ci.yml', '.github/workflows/release.yml'],
    ],
    [CI_WORKFLOW, ['.github/workflows/ci.yml']],
  ]),
  updates: [
    makeUpdate(CI_WORKFLOW, TARGET_PINS[0]!),
    makeUpdate(SETUP_ACTION, TARGET_PINS[1]!),
  ],
  workflows: ['.github/workflows/ci.yml', '.github/workflows/release.yml'],
  lockfile: LOCKFILE,
}

/**
 * What the regenerated lockfile of the vendored repository pins.
 */
const VENDORED_PINS = [makePin('actions/setup-node', 'v5', SETUP_NODE_SHA)]

/**
 * Target that relocks the vendored repository for its written CI workflow.
 */
const VENDORED_TARGET: RelockTarget = {
  files: new Map([[VENDORED_WORKFLOW, ['.github/workflows/ci.yml']]]),
  updates: [makeUpdate(VENDORED_WORKFLOW, VENDORED_PINS[0]!)],
  workflows: ['.github/workflows/ci.yml'],
  lockfile: VENDORED,
}

/**
 * Text of a lockfile that records the given pins for both tracked workflows of
 * `/repo`, the CI workflow of the vendored repository included.
 *
 * @param pins - What the lockfile pins.
 * @returns Content of the lockfile.
 */
function makeLockfileWith(...pins: LockPin[]): string {
  let keys = pins.map(pin => `${pin.repository}@${pin.ref}`)
  return makeLockfileText({
    dependencies: Object.fromEntries(
      pins.map(pin => [`${pin.repository}@${pin.ref}`, pin.sha]),
    ),
    workflows: {
      '.github/workflows/release.yml': keys,
      '.github/workflows/ci.yml': keys,
    },
  })
}

/**
 * Lockfile that records what was checked for every target, as gh-actions-lock
 * writes it once it pinned what it reported.
 */
const AS_CHECKED = makeLockfileWith(...TARGET_PINS, ...VENDORED_PINS)

/**
 * Files the updater rewrote.
 */
const WRITTEN: WrittenFile[] = [
  {
    before: 'uses: actions/setup-node@v4\n',
    after: 'uses: actions/setup-node@v5\n',
    path: VENDORED_WORKFLOW,
  },
  {
    before: 'uses: actions/checkout@v3\n',
    after: 'uses: actions/checkout@v4\n',
    path: CI_WORKFLOW,
  },
  {
    before: 'uses: actions/cache@v4\n',
    after: 'uses: actions/cache@v5\n',
    path: SETUP_ACTION,
  },
]

/**
 * Result of a run that blocked on a reference that does not exist.
 */
const BLOCKED: RelockResult = {
  findings: [
    {
      docUrl:
        'https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md#ref-missing',
      detail: 'ref v999 does not exist in actions/setup-node',
      workflow: '.github/workflows/ci.yml',
      category: 'ref-missing',
    },
    {
      detail: 'lockfile cannot be written',
      category: '',
      docUrl: null,
      workflow: '',
    },
  ],
  reason: 'it found problems that block the lockfile',
  kind: 'failed',
}

/**
 * Heading of the notice for the blocked run of the lockfile of `/repo`.
 */
const BLOCKED_HEADING =
  'gh actions-lock did not regenerate .github/workflows/actions.lock: it found problems that block the lockfile'

/**
 * Lines that describe the findings of the blocked run.
 */
const BLOCKED_DETAILS = [
  '.github/workflows/ci.yml: ref v999 does not exist in actions/setup-node (ref-missing)\n     https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md#ref-missing',
  'lockfile cannot be written',
]

/**
 * Heading of the notice for a lockfile of `/repo` that does not pin what was
 * checked.
 */
const NOT_AS_CHECKED_HEADING =
  'gh actions-lock did not pin what Actions Up checked in .github/workflows/actions.lock'

/**
 * Line that describes `actions/checkout@v4` pinned to a commit the lockfile did
 * not pin before.
 */
const OTHER_COMMIT_DETAIL =
  'actions/checkout@v4 is pinned to 11bd719, not to the checked 11d5960: it moved after Actions Up checked it, so the pinned commit skipped the cool-down and trust checks; review it, or undo the changes with Git'

/**
 * What follows a pin the lockfile kept when the files keep their updates, up to
 * the command that moves it forward.
 */
const MOVE_KEPT_PIN =
  'this moves the pin forward for every workflow that uses it, along with each other reference of these workflows that moved, without the cool-down and trust checks:'

/**
 * Line that describes `actions/checkout@v4` kept at the commit the lockfile
 * pinned before.
 */
const KEPT_COMMIT_LINE =
  'actions/checkout@v4 stays pinned to 11bd719, which the lockfile pinned before, not to the checked 11d5960'

/**
 * Line that describes `actions/checkout@v4` kept at the commit the lockfile
 * pinned before, with the command that moves it forward for the CI workflow,
 * which it was written for.
 */
const KEPT_COMMIT_DETAIL = `${KEPT_COMMIT_LINE}; ${MOVE_KEPT_PIN}\n     GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows gh actions-lock --no-onboard --no-narrow --relock -- .github/workflows/ci.yml`

/**
 * Line that describes `actions/cache@v5` left out of the lockfile.
 */
const MISSING_DETAIL =
  'actions/cache@v5 is not pinned: gh actions-lock left it out of the lockfile'

/**
 * Line that describes `actions/cache@v5` refused for the release workflow.
 */
const REFUSED_DETAIL =
  'actions/cache@v5 is not pinned for .github/workflows/release.yml: its entry in the lockfile did not track the action, and gh actions-lock adds it only without --no-onboard'

/**
 * Files of the lockfile of `/repo` as the notices show them.
 */
const TARGET_FILES = [
  '.github/workflows/ci.yml',
  '.github/actions/setup/action.yml',
]

describe('regenerateLockfiles', () => {
  let signals: HeldSignals

  /**
   * Let each read of a lockfile return the next of the given contents.
   *
   * @param contents - Texts or bytes in the order of the reads, null for a
   *   failed read.
   */
  function arrangeLockfileReads(...contents: (Buffer | string | null)[]): void {
    for (let content of contents) {
      if (content === null) {
        vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
      } else {
        vi.mocked(readFile).mockResolvedValueOnce(Buffer.from(content))
      }
    }
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(spinnerMock.start).mockReturnValue(spinnerMock)
    createSpinnerMock.mockReturnValue(spinnerMock)
    vi.spyOn(process, 'cwd').mockReturnValue('/repo')
    signals = { release: vi.fn<() => void>(), signal: null }
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        Buffer.from(
          WRITTEN.find(file => file.path === path)?.after ?? AS_CHECKED,
        ),
      ),
    )
    vi.mocked(restoreWrittenFiles).mockImplementation(files =>
      Promise.resolve({
        restored: files.map(file => file.path),
        failed: new Map(),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('regenerates each lockfile in turn when it pins what was checked', async () => {
    vi.mocked(relockWorkflows)
      .mockResolvedValueOnce({
        pins: TARGET_PINS,
        kind: 'relocked',
        refusals: [],
      })
      .mockResolvedValueOnce({
        pins: VENDORED_PINS,
        kind: 'relocked',
        refusals: [],
      })

    await expect(
      regenerateLockfiles([TARGET, VENDORED_TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
    expect(vi.mocked(relockWorkflows).mock.calls).toStrictEqual([
      [LOCKFILE, TARGET.workflows],
      [VENDORED, VENDORED_TARGET.workflows],
    ])
    expect(createSpinnerMock.mock.calls).toStrictEqual([
      [
        'Regenerating .github/workflows/actions.lock...',
        {
          waitText: 'Waiting for gh actions-lock to finish...',
          exitOnSignal: false,
        },
      ],
      [
        'Regenerating vendor/tool/.github/workflows/actions.lock...',
        {
          waitText: 'Waiting for gh actions-lock to finish...',
          exitOnSignal: false,
        },
      ],
    ])
    expect(spinnerMock.start).toHaveBeenCalledTimes(2)
    expect(vi.mocked(spinnerMock.success).mock.calls).toStrictEqual([
      ['Regenerated .github/workflows/actions.lock'],
      ['Regenerated vendor/tool/.github/workflows/actions.lock'],
    ])
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).not.toHaveBeenCalled()
    expect(signals.release).not.toHaveBeenCalled()
  })

  it('regenerates a lockfile that pins a written reference to the older commit it already pinned, as for another workflow, and names it', async () => {
    arrangeLockfileReads(
      makeLockfileText({
        workflows: { '.github/workflows/release.yml': ['actions/checkout@v4'] },
        dependencies: { 'actions/checkout@v4': RECORDED_SHA },
      }),
      makeLockfileWith(
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ),
    )
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: [
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ],
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
    expect(spinnerMock.success).toHaveBeenCalledExactlyOnceWith(
      'Regenerated .github/workflows/actions.lock',
    )
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      heading:
        'gh actions-lock kept earlier pins in .github/workflows/actions.lock',
      details: [KEPT_COMMIT_DETAIL],
      unrestored: [],
      command: null,
      restored: [],
      left: [],
    })
  })

  it('regenerates a lockfile that pins a reference of a repository that moved to the older commit it already pinned under the new name, and names both', async () => {
    let pins = [
      makePin('my-org/checkout', 'v4', RECORDED_SHA),
      makePin('actions/cache', 'v5', CACHE_SHA),
    ]
    arrangeLockfileReads(
      makeLockfileText({
        workflows: {
          '.github/workflows/release.yml': ['my-org/checkout@v4'],
        },
        dependencies: { 'my-org/checkout@v4': RECORDED_SHA },
      }),
      makeLockfileWith(...pins),
      'uses: my-org/checkout@v4\n',
    )
    vi.mocked(relockWorkflows).mockResolvedValue({
      kind: 'relocked',
      refusals: [],
      pins,
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
    expect(spinnerMock.success).toHaveBeenCalledExactlyOnceWith(
      'Regenerated .github/workflows/actions.lock',
    )
    expect(vi.mocked(printRelockNotice).mock.calls).toStrictEqual([
      [
        {
          heading:
            'gh actions-lock kept earlier pins in .github/workflows/actions.lock',
          details: [KEPT_COMMIT_DETAIL],
          unrestored: [],
          command: null,
          restored: [],
          left: [],
        },
      ],
      [
        {
          heading:
            'gh actions-lock also rewrote 1 file: a repository that moved is renamed in the workflow, which drops the comment of that line',
          details: ['.github/workflows/ci.yml'],
          unrestored: [],
          command: null,
          restored: [],
          left: [],
        },
      ],
    ])
  })

  it('names the command that moves a pin the lockfile of a nested repository kept forward from the working directory', async () => {
    arrangeLockfileReads(
      makeLockfileText({
        workflows: {
          '.github/workflows/release.yml': ['actions/setup-node@v5'],
        },
        dependencies: { 'actions/setup-node@v5': RECORDED_SHA },
      }),
      makeLockfileText({
        workflows: {
          '.github/workflows/release.yml': ['actions/setup-node@v5'],
          '.github/workflows/ci.yml': ['actions/setup-node@v5'],
        },
        dependencies: { 'actions/setup-node@v5': RECORDED_SHA },
      }),
    )
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: [makePin('actions/setup-node', 'v5', RECORDED_SHA)],
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([VENDORED_TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      details: [
        `actions/setup-node@v5 stays pinned to 11bd719, which the lockfile pinned before, not to the checked a0853c2; ${MOVE_KEPT_PIN}\n     (cd -P ./vendor/tool && GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows gh actions-lock --no-onboard --no-narrow --relock -- .github/workflows/ci.yml)`,
      ],
      heading:
        'gh actions-lock kept earlier pins in vendor/tool/.github/workflows/actions.lock',
      unrestored: [],
      command: null,
      restored: [],
      left: [],
    })
  })

  it('fails a lockfile that pins a written reference to a commit it pinned before only for another reference', async () => {
    arrangeLockfileReads(
      makeLockfileText({
        workflows: {
          '.github/workflows/release.yml': ['actions/checkout@v4.0.0'],
        },
        dependencies: { 'actions/checkout@v4.0.0': RECORDED_SHA },
      }),
      makeLockfileWith(
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ),
    )
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: [
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ],
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 1,
    })
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ details: [OTHER_COMMIT_DETAIL] }),
    )
  })

  it('fails a lockfile that also pins another written reference to a commit it did not pin before, naming both', async () => {
    arrangeLockfileReads(
      makeLockfileText({
        workflows: { '.github/workflows/release.yml': ['actions/checkout@v4'] },
        dependencies: { 'actions/checkout@v4': RECORDED_SHA },
      }),
      makeLockfileWith(
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', SETUP_NODE_SHA),
      ),
    )
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: [
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', SETUP_NODE_SHA),
      ],
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 1,
    })
    expect(spinnerMock.success).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      details: [
        KEPT_COMMIT_DETAIL,
        'actions/cache@v5 is pinned to a0853c2, not to the checked caa2961: it moved after Actions Up checked it, so the pinned commit skipped the cool-down and trust checks; review it, or undo the changes with Git',
      ],
      heading: NOT_AS_CHECKED_HEADING,
      left: TARGET_FILES,
      unrestored: [],
      command: null,
      restored: [],
    })
  })

  it('puts back the files of a lockfile gh-actions-lock did not regenerate, and goes on with the next one', async () => {
    vi.mocked(relockWorkflows)
      .mockResolvedValueOnce(BLOCKED)
      .mockResolvedValueOnce({
        pins: VENDORED_PINS,
        kind: 'relocked',
        refusals: [],
      })
    vi.mocked(restoreWrittenFiles).mockResolvedValueOnce({
      restored: [CI_WORKFLOW],
      failed: new Map(),
    })

    await expect(
      regenerateLockfiles([TARGET, VENDORED_TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      restored: new Set([CI_WORKFLOW]),
      unrestored: new Set(),
      exitCode: 1,
    })
    expect(restoreWrittenFiles).toHaveBeenCalledExactlyOnceWith([
      WRITTEN[1],
      WRITTEN[2],
    ])
    expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
      'Could not regenerate .github/workflows/actions.lock',
    )
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      left: ['.github/actions/setup/action.yml'],
      restored: ['.github/workflows/ci.yml'],
      details: BLOCKED_DETAILS,
      heading: BLOCKED_HEADING,
      command: COMMAND,
      unrestored: [],
    })
    expect(relockWorkflows).toHaveBeenCalledTimes(2)
  })

  it('lists a file that could not be put back apart from the files that keep their updates', async () => {
    vi.mocked(relockWorkflows).mockResolvedValue(BLOCKED)
    vi.mocked(restoreWrittenFiles).mockResolvedValueOnce({
      failed: new Map([[CI_WORKFLOW, 'EIO: i/o error, write']]),
      restored: [SETUP_ACTION],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set([CI_WORKFLOW]),
      restored: new Set([SETUP_ACTION]),
      exitCode: 1,
    })
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      unrestored: ['.github/workflows/ci.yml: EIO: i/o error, write'],
      restored: ['.github/actions/setup/action.yml'],
      details: BLOCKED_DETAILS,
      heading: BLOCKED_HEADING,
      command: COMMAND,
      left: [],
    })
  })

  it('leaves the files when a failed run changed the lockfile', async () => {
    arrangeLockfileReads('lock\n', 'half-written lock\n')
    vi.mocked(relockWorkflows).mockResolvedValue({
      ...BLOCKED,
      reason: 'renaming lockfile: permission denied',
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 1,
    })
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      heading:
        'gh actions-lock did not regenerate .github/workflows/actions.lock: renaming lockfile: permission denied',
      details: BLOCKED_DETAILS,
      left: TARGET_FILES,
      command: COMMAND,
      unrestored: [],
      restored: [],
    })
  })

  it.each([
    ['before and after the run', [null, null]],
    ['after the run', ['lock\n', null]],
  ])(
    'leaves the files of a failed run when the lockfile could not be read %s, since it may have changed',
    async (_description, reads) => {
      arrangeLockfileReads(...reads)
      vi.mocked(relockWorkflows).mockResolvedValue(BLOCKED)

      await expect(
        regenerateLockfiles([TARGET], WRITTEN, signals),
      ).resolves.toStrictEqual({
        unrestored: new Set(),
        restored: new Set(),
        exitCode: 1,
      })
      expect(restoreWrittenFiles).not.toHaveBeenCalled()
      expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ left: TARGET_FILES, restored: [] }),
      )
    },
  )

  it.each([
    ['changed', 'old lock\n'],
    ['could not be read before', null],
  ])(
    'leaves the files with a lockfile gh-actions-lock %s while it pinned a commit it did not pin before, other than the checked one',
    async (_description, before) => {
      arrangeLockfileReads(
        before,
        makeLockfileWith(
          makePin('actions/checkout', 'v4', RECORDED_SHA),
          makePin('actions/cache', 'v5', CACHE_SHA),
        ),
      )
      vi.mocked(relockWorkflows).mockResolvedValue({
        pins: [
          makePin('actions/checkout', 'v4', RECORDED_SHA),
          makePin('actions/cache', 'v5', CACHE_SHA),
        ],
        kind: 'relocked',
        refusals: [],
      })

      await expect(
        regenerateLockfiles([TARGET], WRITTEN, signals),
      ).resolves.toStrictEqual({
        unrestored: new Set(),
        restored: new Set(),
        exitCode: 1,
      })
      expect(restoreWrittenFiles).not.toHaveBeenCalled()
      expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
        'Regenerated .github/workflows/actions.lock, but not as checked',
      )
      expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
        heading: NOT_AS_CHECKED_HEADING,
        details: [OTHER_COMMIT_DETAIL],
        left: TARGET_FILES,
        unrestored: [],
        command: null,
        restored: [],
      })
    },
  )

  it('regenerates a lockfile whose relock refused a written reference only for a workflow it was not written for, and names that reference', async () => {
    vi.mocked(relockWorkflows).mockResolvedValue({
      refusals: [
        {
          workflow: '.github/workflows/release.yml',
          dependency: 'actions/checkout@v4',
          repository: 'actions/checkout',
          ref: 'v4',
        },
      ],
      pins: TARGET_PINS,
      kind: 'relocked',
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
    expect(spinnerMock.success).toHaveBeenCalledExactlyOnceWith(
      'Regenerated .github/workflows/actions.lock',
    )
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      details: [
        'actions/checkout@v4 is not pinned for .github/workflows/release.yml: its entry in the lockfile does not track the action; run gh actions-lock without --no-onboard to add it',
      ],
      heading:
        'gh actions-lock left references unpinned in .github/workflows/actions.lock',
      unrestored: [],
      command: null,
      restored: [],
      left: [],
    })
  })

  it('names each reference a relocked workflow still does not pin once, after the earlier pins the lockfile kept', async () => {
    arrangeLockfileReads(
      makeLockfileText({
        workflows: { '.github/workflows/release.yml': ['actions/checkout@v4'] },
        dependencies: { 'actions/checkout@v4': RECORDED_SHA },
      }),
      makeLockfileWith(
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ),
    )
    let untracked = {
      dependency:
        'my-org/actions/yarn-install@a9e1b5817bc3a7d4de6e9abf2a4e28b4ab6a7b74',
      ref: 'a9e1b5817bc3a7d4de6e9abf2a4e28b4ab6a7b74',
      workflow: '.github/workflows/release.yml',
      repository: 'my-org/actions',
    }
    vi.mocked(relockWorkflows).mockResolvedValue({
      refusals: [
        untracked,
        untracked,
        { ...untracked, workflow: '.github/workflows/docs.yml' },
      ],
      pins: [
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ],
      kind: 'relocked',
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 0,
    })
    expect(vi.mocked(printRelockNotice).mock.calls).toStrictEqual([
      [
        {
          heading:
            'gh actions-lock kept earlier pins in .github/workflows/actions.lock',
          details: [KEPT_COMMIT_DETAIL],
          unrestored: [],
          command: null,
          restored: [],
          left: [],
        },
      ],
      [
        {
          details: [
            'my-org/actions/yarn-install@a9e1b5817bc3a7d4de6e9abf2a4e28b4ab6a7b74 is not pinned for .github/workflows/release.yml: its entry in the lockfile does not track the action; run gh actions-lock without --no-onboard to add it',
          ],
          heading:
            'gh actions-lock left references unpinned in .github/workflows/actions.lock',
          unrestored: [],
          command: null,
          restored: [],
          left: [],
        },
      ],
    ])
  })

  it('fails a lockfile that pins a written reference for one workflow while it was refused for another that runs the written file', async () => {
    arrangeLockfileReads('old lock\n', AS_CHECKED)
    vi.mocked(relockWorkflows).mockResolvedValue({
      refusals: [
        {
          workflow: '.github/workflows/release.yml',
          dependency: 'actions/cache@v5',
          repository: 'actions/cache',
          ref: 'v5',
        },
      ],
      pins: TARGET_PINS,
      kind: 'relocked',
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 1,
    })
    expect(spinnerMock.success).not.toHaveBeenCalled()
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        details: [REFUSED_DETAIL],
        left: TARGET_FILES,
        command: null,
      }),
    )
  })

  it('puts back the files of a reference the lockfile did not add, which left the lockfile as it was', async () => {
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: [makePin('actions/checkout', 'v4', CHECKOUT_SHA)],
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      restored: new Set([SETUP_ACTION, CI_WORKFLOW]),
      unrestored: new Set(),
      exitCode: 1,
    })
    expect(restoreWrittenFiles).toHaveBeenCalledExactlyOnceWith([
      WRITTEN[1],
      WRITTEN[2],
    ])
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      heading: NOT_AS_CHECKED_HEADING,
      details: [MISSING_DETAIL],
      restored: TARGET_FILES,
      unrestored: [],
      command: null,
      left: [],
    })
  })

  it('puts back the files of a lockfile that does not record on disk what gh-actions-lock reported as pinned, which left it as it was', async () => {
    let stale = makeLockfileWith(
      makePin('actions/checkout', 'v3', CHECKOUT_SHA),
    )
    arrangeLockfileReads(stale, stale)
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: TARGET_PINS,
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      restored: new Set([SETUP_ACTION, CI_WORKFLOW]),
      unrestored: new Set(),
      exitCode: 1,
    })
    expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
      'Regenerated .github/workflows/actions.lock, but not as checked',
    )
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      details: [
        'actions/checkout@v4 is not recorded for .github/workflows/ci.yml in the lockfile on disk, though gh actions-lock reported it as pinned',
        'actions/cache@v5 is not recorded for .github/workflows/ci.yml in the lockfile on disk, though gh actions-lock reported it as pinned',
        'actions/cache@v5 is not recorded for .github/workflows/release.yml in the lockfile on disk, though gh actions-lock reported it as pinned',
      ],
      heading: NOT_AS_CHECKED_HEADING,
      restored: TARGET_FILES,
      unrestored: [],
      command: null,
      left: [],
    })
  })

  it('names a pin the lockfile kept without a command once the files are put back', async () => {
    let unchanged = makeLockfileText({
      workflows: { '.github/workflows/release.yml': ['actions/checkout@v4'] },
      dependencies: { 'actions/checkout@v4': RECORDED_SHA },
    })
    arrangeLockfileReads(unchanged, unchanged)
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: [
        makePin('actions/checkout', 'v4', RECORDED_SHA),
        makePin('actions/cache', 'v5', CACHE_SHA),
      ],
      kind: 'relocked',
      refusals: [],
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      restored: new Set([SETUP_ACTION, CI_WORKFLOW]),
      unrestored: new Set(),
      exitCode: 1,
    })
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      details: [
        KEPT_COMMIT_LINE,
        'actions/checkout@v4 is not recorded for .github/workflows/ci.yml in the lockfile on disk, though gh actions-lock reported it as pinned',
        'actions/cache@v5 is not recorded for .github/workflows/ci.yml in the lockfile on disk, though gh actions-lock reported it as pinned',
        'actions/cache@v5 is not recorded for .github/workflows/release.yml in the lockfile on disk, though gh actions-lock reported it as pinned',
      ],
      heading: NOT_AS_CHECKED_HEADING,
      restored: TARGET_FILES,
      unrestored: [],
      command: null,
      left: [],
    })
  })

  it.each([
    ['cannot be read', null, 'unreadable file'],
    ['holds no lockfile', 'Pruned 2 deleted workflows\n', 'not a mapping'],
    [
      'names a schema version this release does not know',
      makeLockfileText({ version: 'v0.0.4' }),
      'unsupported schema version v0.0.4',
    ],
  ])(
    'fails a lockfile gh-actions-lock regenerated that %s, keeping the files',
    async (_description, after, reason) => {
      arrangeLockfileReads(AS_CHECKED, after)
      vi.mocked(relockWorkflows).mockResolvedValue({
        pins: TARGET_PINS,
        kind: 'relocked',
        refusals: [],
      })

      await expect(
        regenerateLockfiles([TARGET], WRITTEN, signals),
      ).resolves.toStrictEqual({
        unrestored: new Set(),
        restored: new Set(),
        exitCode: 1,
      })
      expect(restoreWrittenFiles).not.toHaveBeenCalled()
      expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
        'Regenerated .github/workflows/actions.lock, but could not check it',
      )
      expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
        heading: `gh actions-lock regenerated .github/workflows/actions.lock, but it cannot be read (${reason}), so Actions Up could not check what it pins`,
        left: TARGET_FILES,
        unrestored: [],
        command: null,
        restored: [],
        details: [],
      })
    },
  )

  it.each([
    {
      pins: [
        makePin('my-org/checkout', 'v4', CHECKOUT_SHA),
        makePin('my-org/cache', 'v5', CACHE_SHA),
      ],
      setup: 'uses: my-org/cache@v5\n',
      rewritten: TARGET_FILES,
      files: '2 files',
    },
    {
      pins: [makePin('my-org/checkout', 'v4', CHECKOUT_SHA), TARGET_PINS[1]!],
      rewritten: ['.github/workflows/ci.yml'],
      setup: WRITTEN[2]!.after,
      files: '1 file',
    },
  ])(
    'names the $files gh-actions-lock rewrote for a repository that moved while it regenerated the lockfile as checked',
    async ({ rewritten, setup, files, pins }) => {
      let renamed = makeLockfileWith(...pins)
      let contents = [
        [CI_WORKFLOW, 'uses: my-org/checkout@v4\n'],
        [SETUP_ACTION, setup],
      ]
      vi.mocked(readFile).mockImplementation(path =>
        Promise.resolve(
          Buffer.from(contents.find(([file]) => file === path)?.[1] ?? renamed),
        ),
      )
      vi.mocked(relockWorkflows).mockResolvedValue({
        kind: 'relocked',
        refusals: [],
        pins,
      })

      await expect(
        regenerateLockfiles([TARGET], WRITTEN, signals),
      ).resolves.toStrictEqual({
        unrestored: new Set(),
        restored: new Set(),
        exitCode: 0,
      })
      expect(spinnerMock.success).toHaveBeenCalledExactlyOnceWith(
        'Regenerated .github/workflows/actions.lock',
      )
      expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
        heading: `gh actions-lock also rewrote ${files}: a repository that moved is renamed in the workflow, which drops the comment of that line`,
        details: rewritten,
        unrestored: [],
        command: null,
        restored: [],
        left: [],
      })
    },
  )

  it.each([
    {
      ci: 'uses: actions/checkout@v3.0.0\n',
      changed: ['.github/workflows/ci.yml'],
      name: 'another reference',
      setup: WRITTEN[2]!.after,
      files: '1 file',
    },
    {
      name: 'a new name the lockfile does not pin',
      changed: ['.github/workflows/ci.yml'],
      ci: 'uses: my-org/checkout@v4\n',
      setup: WRITTEN[2]!.after,
      files: '1 file',
    },
    {
      ci: 'uses: actions/checkout@v4\nuses: actions/cache@v5\n',
      name: 'lines a rename does not explain',
      setup: 'uses: my-org/cache@v5\n',
      changed: TARGET_FILES,
      files: '2 files',
    },
    {
      changed: ['.github/actions/setup/action.yml'],
      name: 'no bytes it can read',
      ci: WRITTEN[1]!.after,
      files: '1 file',
      setup: null,
    },
  ])(
    'fails a lockfile regenerated as checked when a written file then holds $name, keeping the updates',
    async ({ changed, setup, files, ci }) => {
      vi.mocked(readFile).mockImplementation(path => {
        if (path === SETUP_ACTION) {
          return setup === null ?
              Promise.reject(new Error('ENOENT'))
            : Promise.resolve(Buffer.from(setup))
        }
        return Promise.resolve(
          Buffer.from(path === CI_WORKFLOW ? ci : AS_CHECKED),
        )
      })
      arrangeLockfileReads(makeLockfileWith(), AS_CHECKED)
      vi.mocked(relockWorkflows).mockResolvedValue({
        pins: TARGET_PINS,
        kind: 'relocked',
        refusals: [],
      })

      await expect(
        regenerateLockfiles([TARGET], WRITTEN, signals),
      ).resolves.toStrictEqual({
        unrestored: new Set(),
        restored: new Set(),
        exitCode: 1,
      })
      expect(restoreWrittenFiles).not.toHaveBeenCalled()
      expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
        'Regenerated .github/workflows/actions.lock, but could not check it',
      )
      expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
        heading: `${files} changed while gh actions-lock regenerated .github/workflows/actions.lock, so the lockfile may not match the updated files`,
        left: TARGET_FILES,
        details: changed,
        command: COMMAND,
        unrestored: [],
        restored: [],
      })
    },
  )

  it('puts back the other files when a written file changed while gh-actions-lock left the lockfile as it was', async () => {
    vi.mocked(readFile).mockImplementation(path =>
      Promise.resolve(
        Buffer.from(
          path === CI_WORKFLOW ?
            'uses: actions/checkout@v3.0.0\n'
          : (WRITTEN.find(file => file.path === path)?.after ?? AS_CHECKED),
        ),
      ),
    )
    vi.mocked(relockWorkflows).mockResolvedValue({
      pins: TARGET_PINS,
      kind: 'relocked',
      refusals: [],
    })
    vi.mocked(restoreWrittenFiles).mockResolvedValueOnce({
      restored: [SETUP_ACTION],
      failed: new Map(),
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      restored: new Set([SETUP_ACTION]),
      unrestored: new Set(),
      exitCode: 1,
    })
    expect(restoreWrittenFiles).toHaveBeenCalledExactlyOnceWith([
      WRITTEN[1],
      WRITTEN[2],
    ])
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      heading:
        '1 file changed while gh actions-lock regenerated .github/workflows/actions.lock, so the lockfile may not match the updated files',
      restored: ['.github/actions/setup/action.yml'],
      details: ['.github/workflows/ci.yml'],
      left: ['.github/workflows/ci.yml'],
      command: COMMAND,
      unrestored: [],
    })
  })

  it('stops at Ctrl+C, naming each lockfile that may not match its files without putting anything back', async () => {
    vi.mocked(relockWorkflows).mockImplementation(() => {
      signals.signal = 'SIGINT'
      return Promise.resolve({ signal: 'SIGINT', kind: 'stopped' })
    })

    await expect(
      regenerateLockfiles([TARGET, VENDORED_TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 130,
    })
    expect(relockWorkflows).toHaveBeenCalledExactlyOnceWith(
      LOCKFILE,
      TARGET.workflows,
    )
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
      'Stopped regenerating .github/workflows/actions.lock',
    )
    expect(vi.mocked(printRelockNotice).mock.calls).toStrictEqual([
      [
        {
          heading:
            'Stopped, so .github/workflows/actions.lock may not match the updated files',
          left: TARGET_FILES,
          command: COMMAND,
          unrestored: [],
          restored: [],
          details: [],
        },
      ],
      [
        {
          heading:
            'Stopped, so vendor/tool/.github/workflows/actions.lock may not match the updated files',
          left: ['vendor/tool/.github/workflows/ci.yml'],
          command: VENDORED_COMMAND,
          unrestored: [],
          restored: [],
          details: [],
        },
      ],
    ])
  })

  it('finishes a lockfile regenerated while SIGTERM arrived, then stops', async () => {
    vi.mocked(relockWorkflows).mockImplementation(() => {
      signals.signal = 'SIGTERM'
      return Promise.resolve({
        pins: TARGET_PINS,
        kind: 'relocked',
        refusals: [],
      })
    })

    await expect(
      regenerateLockfiles([TARGET, VENDORED_TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 143,
    })
    expect(spinnerMock.success).toHaveBeenCalledExactlyOnceWith(
      'Regenerated .github/workflows/actions.lock',
    )
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        heading:
          'Stopped, so vendor/tool/.github/workflows/actions.lock may not match the updated files',
      }),
    )
  })

  it('ends with the code of a signal that arrived while every lockfile was regenerated as checked', async () => {
    vi.mocked(relockWorkflows).mockImplementation(() => {
      signals.signal = 'SIGINT'
      return Promise.resolve({
        pins: TARGET_PINS,
        kind: 'relocked',
        refusals: [],
      })
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 130,
    })
    expect(spinnerMock.success).toHaveBeenCalledExactlyOnceWith(
      'Regenerated .github/workflows/actions.lock',
    )
    expect(printRelockNotice).not.toHaveBeenCalled()
  })

  it('puts back nothing for a run the CLI was stopped during, even one that pinned other commits, and gives no command that would pin them again', async () => {
    arrangeLockfileReads(
      AS_CHECKED,
      makeLockfileWith(makePin('actions/checkout', 'v4', RECORDED_SHA)),
    )
    vi.mocked(relockWorkflows).mockImplementation(() => {
      signals.signal = 'SIGINT'
      return Promise.resolve({
        pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
        kind: 'relocked',
        refusals: [],
      })
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 130,
    })
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        details: [OTHER_COMMIT_DETAIL, MISSING_DETAIL],
        command: null,
      }),
    )
  })

  it('puts back nothing for a failed run the CLI was stopped during, though the lockfile stayed as it was', async () => {
    vi.mocked(relockWorkflows).mockImplementation(() => {
      signals.signal = 'SIGTERM'
      return Promise.resolve(BLOCKED)
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 143,
    })
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      details: BLOCKED_DETAILS,
      heading: BLOCKED_HEADING,
      left: TARGET_FILES,
      command: COMMAND,
      unrestored: [],
      restored: [],
    })
  })

  it('counts a lockfile as changed when its bytes changed, though they read as the same text', async () => {
    arrangeLockfileReads(Buffer.from([0xff]), Buffer.from([0xfe]))
    vi.mocked(relockWorkflows).mockResolvedValue(BLOCKED)

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 1,
    })
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ left: TARGET_FILES, restored: [] }),
    )
  })

  it('does not start gh when a signal arrives while the lockfile is read', async () => {
    vi.mocked(readFile).mockImplementationOnce(() => {
      signals.signal = 'SIGINT'
      return Promise.resolve(Buffer.from('lock\n'))
    })

    await expect(
      regenerateLockfiles([TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 130,
    })
    expect(relockWorkflows).not.toHaveBeenCalled()
    expect(createSpinnerMock).not.toHaveBeenCalled()
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      heading:
        'Stopped, so .github/workflows/actions.lock may not match the updated files',
      left: TARGET_FILES,
      command: COMMAND,
      unrestored: [],
      restored: [],
      details: [],
    })
  })

  it('goes on after a run that a signal the CLI did not receive ended, naming the signal', async () => {
    vi.mocked(relockWorkflows)
      .mockResolvedValueOnce({ signal: 'SIGKILL', kind: 'stopped' })
      .mockResolvedValueOnce({
        pins: VENDORED_PINS,
        kind: 'relocked',
        refusals: [],
      })

    await expect(
      regenerateLockfiles([TARGET, VENDORED_TARGET], WRITTEN, signals),
    ).resolves.toStrictEqual({
      unrestored: new Set(),
      restored: new Set(),
      exitCode: 1,
    })
    expect(restoreWrittenFiles).not.toHaveBeenCalled()
    expect(relockWorkflows).toHaveBeenCalledTimes(2)
    expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith(
      'Could not regenerate .github/workflows/actions.lock',
    )
    expect(printRelockNotice).toHaveBeenCalledExactlyOnceWith({
      heading:
        'gh actions-lock was ended by SIGKILL, so .github/workflows/actions.lock may not match the updated files',
      left: TARGET_FILES,
      command: COMMAND,
      unrestored: [],
      restored: [],
      details: [],
    })
  })
})
