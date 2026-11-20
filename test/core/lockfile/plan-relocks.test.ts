import { describe, expect, it } from 'vitest'

import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'
import type { LockedFile } from '../../../types/locked-file'

import {
  findRelockBlockers,
  planRelocks,
} from '../../../core/lockfile/plan-relocks'
import { makeWorkflowLockfile } from '../../helpers/make-workflow-lockfile'

const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

const CI_WORKFLOW_LINK = '/home/me/repo/.github/workflows/ci.yml'

const RELEASE_WORKFLOW = '/repo/.github/workflows/release.yml'

const SETUP_ACTION = '/repo/.github/actions/setup/action.yml'

const VENDORED_WORKFLOW = '/repo/vendor/tool/.github/workflows/ci.yml'

/**
 * Lockfile of `/repo` that tracks the CI and release workflows, of which the CI
 * workflow runs the setup action of the repository through `$/`.
 */
const LOCKFILE = makeWorkflowLockfile({
  keys: new Map([
    ['.github/workflows/release.yml', RELEASE_WORKFLOW],
    ['.github/workflows/ci.yml', CI_WORKFLOW],
  ]),
  reached: new Map([[SETUP_ACTION, new Map([[CI_WORKFLOW, true]])]]),
  workflows: new Set([RELEASE_WORKFLOW, CI_WORKFLOW]),
})

/**
 * Lockfile of a repository vendored into `/repo`, which tracks its own CI
 * workflow.
 */
const VENDORED = makeWorkflowLockfile({
  keys: new Map([['.github/workflows/ci.yml', VENDORED_WORKFLOW]]),
  path: '/repo/vendor/tool/.github/workflows/actions.lock',
  workflows: new Set([VENDORED_WORKFLOW]),
  root: '/repo/vendor/tool',
})

/**
 * Files of `/repo` and of the vendored repository whose actions the lockfiles
 * pin. The CI workflow of `/repo` is found through a symbolic link.
 */
const LOCKED_FILES = new Map<string, LockedFile[]>([
  [
    RELEASE_WORKFLOW,
    [{ workflows: ['.github/workflows/release.yml'], lockfile: LOCKFILE }],
  ],
  [
    VENDORED_WORKFLOW,
    [{ workflows: ['.github/workflows/ci.yml'], lockfile: VENDORED }],
  ],
  [
    CI_WORKFLOW_LINK,
    [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
  ],
  [
    SETUP_ACTION,
    [{ workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE }],
  ],
])

/**
 * Create a written update to a locked action of a file.
 *
 * @param file - File the action is written in.
 * @param action - Fields of the action to replace.
 * @returns Update the writer wrote.
 */
function makeUpdate(
  file: undefined | string,
  action: Partial<GitHubAction> = {},
): ActionUpdate {
  return {
    action: {
      name: 'actions/checkout',
      type: 'external',
      locked: true,
      file,
      ...action,
    },
    latestSha: '11d5960a326750d5838078e36cf38b85af677262',
    latestVersion: 'v4.3.1',
    targetRefStyle: 'tag',
    currentVersion: 'v3',
    publishedAt: null,
    isBreaking: true,
    hasUpdate: true,
    targetRef: 'v4',
    status: 'ok',
  }
}

describe('findRelockBlockers', () => {
  it('finds nothing for files a single lockfile records under a workflow', () => {
    expect(findRelockBlockers(LOCKED_FILES)).toStrictEqual(new Map())
  })

  it('tells why a file cannot be relocked', () => {
    let unreadable = makeWorkflowLockfile({ error: 'invalid YAML', keys: null })
    let untraced = makeWorkflowLockfile({ reached: null })
    let local = makeWorkflowLockfile({
      reached: new Map([[SETUP_ACTION, new Map([[CI_WORKFLOW, false]])]]),
    })

    expect(
      findRelockBlockers(
        new Map<string, LockedFile[]>([
          [
            RELEASE_WORKFLOW,
            [
              {
                workflows: ['.github/workflows/release.yml'],
                lockfile: LOCKFILE,
              },
              { workflows: null, lockfile: local },
              { lockfile: unreadable, workflows: null },
            ],
          ],
          [
            VENDORED_WORKFLOW,
            [
              { workflows: ['.github/workflows/ci.yml'], lockfile: VENDORED },
              { workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE },
            ],
          ],
          [
            CI_WORKFLOW_LINK,
            [
              { workflows: ['.github/workflows/ci.yml'], lockfile: LOCKFILE },
              { workflows: null, lockfile: local },
            ],
          ],
          [
            SETUP_ACTION,
            [
              { workflows: null, lockfile: local },
              { lockfile: untraced, workflows: null },
            ],
          ],
          [CI_WORKFLOW, [{ workflows: null, lockfile: local }]],
        ]),
      ),
    ).toStrictEqual(
      new Map([
        [RELEASE_WORKFLOW, 'unreadable'],
        [CI_WORKFLOW_LINK, 'unrecorded'],
        [VENDORED_WORKFLOW, 'shared'],
        [SETUP_ACTION, 'unreadable'],
        [CI_WORKFLOW, 'unrecorded'],
      ]),
    )
  })
})

describe('planRelocks', () => {
  it('relocks a written workflow under the key the lockfile names it by', () => {
    let update = makeUpdate(CI_WORKFLOW_LINK)

    expect(planRelocks(LOCKED_FILES, [update])).toStrictEqual([
      {
        files: new Map([[CI_WORKFLOW_LINK, ['.github/workflows/ci.yml']]]),
        workflows: ['.github/workflows/ci.yml'],
        lockfile: LOCKFILE,
        updates: [update],
      },
    ])
  })

  it('relocks a written action of the repository under the workflows that run it through $/, each workflow once and sorted', () => {
    let lockedFiles = new Map<string, LockedFile[]>([
      ...LOCKED_FILES,
      [
        SETUP_ACTION,
        [
          {
            workflows: [
              '.github/workflows/release.yml',
              '.github/workflows/ci.yml',
            ],
            lockfile: LOCKFILE,
          },
        ],
      ],
    ])
    let setup = makeUpdate(SETUP_ACTION, { name: 'actions/cache' })
    let release = makeUpdate(RELEASE_WORKFLOW)

    expect(planRelocks(lockedFiles, [setup, release])).toStrictEqual([
      {
        files: new Map([
          [
            SETUP_ACTION,
            ['.github/workflows/release.yml', '.github/workflows/ci.yml'],
          ],
          [RELEASE_WORKFLOW, ['.github/workflows/release.yml']],
        ]),
        workflows: [
          '.github/workflows/ci.yml',
          '.github/workflows/release.yml',
        ],
        updates: [setup, release],
        lockfile: LOCKFILE,
      },
    ])
  })

  it('relocks each lockfile once, in the order of their paths', () => {
    let vendored = makeUpdate(VENDORED_WORKFLOW)
    let checkout = makeUpdate(RELEASE_WORKFLOW)
    let setupNode = makeUpdate(RELEASE_WORKFLOW, { name: 'actions/setup-node' })

    expect(
      planRelocks(LOCKED_FILES, [vendored, checkout, setupNode]),
    ).toStrictEqual([
      {
        files: new Map([[RELEASE_WORKFLOW, ['.github/workflows/release.yml']]]),
        workflows: ['.github/workflows/release.yml'],
        updates: [checkout, setupNode],
        lockfile: LOCKFILE,
      },
      {
        files: new Map([[VENDORED_WORKFLOW, ['.github/workflows/ci.yml']]]),
        workflows: ['.github/workflows/ci.yml'],
        updates: [vendored],
        lockfile: VENDORED,
      },
    ])
  })

  it('leaves out a lockfile that records a file under no workflow, which a relock without workflows would regenerate whole', () => {
    expect(
      planRelocks(
        new Map([[SETUP_ACTION, [{ lockfile: LOCKFILE, workflows: null }]]]),
        [makeUpdate(SETUP_ACTION)],
      ),
    ).toStrictEqual([])
  })

  it('plans nothing for updates no lockfile pins', () => {
    expect(
      planRelocks(LOCKED_FILES, [
        makeUpdate(RELEASE_WORKFLOW, { locked: undefined, type: 'runner' }),
        makeUpdate('/repo/.github/workflows/lint.yml'),
        makeUpdate(undefined),
      ]),
    ).toStrictEqual([])
  })
})
