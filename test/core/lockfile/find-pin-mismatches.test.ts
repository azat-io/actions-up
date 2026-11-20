import { describe, expect, it } from 'vitest'

import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'
import type { LockRefusal } from '../../../types/lock-refusal'
import type { LockPin } from '../../../types/lock-pin'

import { findPinMismatches } from '../../../core/lockfile/find-pin-mismatches'

/**
 * Commit `v4` of `actions/checkout` points at now, which the plan checked.
 */
const CHECKED_SHA = '11d5960a326750d5838078e36cf38b85af677262'

/**
 * Commit an earlier relock recorded for `actions/checkout@v4`.
 */
const RECORDED_SHA = '11bd71901bbe5b1630ceea73d27597364c9af683'

/**
 * Commit `v4` of `actions/upload-artifact` points at now.
 */
const UPLOAD_SHA = 'ea165f8d65b6e75b540449e92b4886f43607fa02'

/**
 * Create a written update of a locked action of the CI workflow to `v4`.
 *
 * @param overrides - Fields to replace.
 * @param action - Fields of the action to replace.
 * @returns Update the writer wrote.
 */
function makeUpdate(
  overrides: Partial<Omit<ActionUpdate, 'action'>> = {},
  action: Partial<GitHubAction> = {},
): ActionUpdate {
  return {
    action: {
      file: '/repo/.github/workflows/ci.yml',
      name: 'actions/checkout',
      type: 'external',
      version: 'v3',
      locked: true,
      ...action,
    },
    latestVersion: 'v4.3.1',
    latestSha: CHECKED_SHA,
    targetRefStyle: 'tag',
    currentVersion: 'v3',
    publishedAt: null,
    isBreaking: true,
    hasUpdate: true,
    targetRef: 'v4',
    status: 'ok',
    ...overrides,
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
 * Reference the relock refused to pin for a workflow.
 *
 * @param workflow - Workflow, relative to the repository root.
 * @param repository - Repository, `owner/repo`.
 * @returns What gh-actions-lock reports for the workflow.
 */
function makeRefusal(workflow: string, repository: string): LockRefusal {
  return { repository, ref: 'v4', workflow }
}

describe('findPinMismatches', () => {
  it('finds nothing when every written reference is pinned to the checked commit', () => {
    let setupNodeSha = '49933ea5288caeca8642d1e84afbd3f7d6820020'

    expect(
      findPinMismatches(
        [
          makeUpdate({}, { name: 'Actions/Checkout' }),
          makeUpdate(
            {
              latestSha: setupNodeSha.toUpperCase(),
              targetRef: setupNodeSha,
              targetRefStyle: 'sha',
            },
            { name: 'actions/setup-node' },
          ),
          makeUpdate({}, { name: 'github/codeql-action/init' }),
        ],
        {
          pins: [
            makePin('actions/checkout', 'v4', CHECKED_SHA),
            makePin('actions/setup-node', setupNodeSha, setupNodeSha),
            makePin('github/codeql-action', 'v4', CHECKED_SHA),
          ],
          refusals: [],
        },
        new Map(),
      ),
    ).toStrictEqual([])
  })

  it.each([
    ['for no reference', new Map<string, string>()],
    [
      'for another reference of the repository, or of another one',
      new Map([
        ['actions/checkout@v4.0.0', RECORDED_SHA],
        ['actions/cache@v4', RECORDED_SHA],
      ]),
    ],
  ])(
    'reports a reference the lockfile pins to another commit than the checked one, which it pinned before %s',
    (_description, recorded) => {
      expect(
        findPinMismatches(
          [makeUpdate()],
          {
            pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
            refusals: [],
          },
          recorded,
        ),
      ).toStrictEqual([
        {
          reference: 'actions/checkout@v4',
          kind: 'other-commit',
          pinned: RECORDED_SHA,
          checked: CHECKED_SHA,
        },
      ])
    },
  )

  it('tells a reference pinned to the older commit the lockfile already pinned, as for another workflow, apart from one that moved', () => {
    expect(
      findPinMismatches(
        [makeUpdate()],
        {
          pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
          refusals: [],
        },
        new Map([['actions/checkout@v4', RECORDED_SHA]]),
      ),
    ).toStrictEqual([
      {
        reference: 'actions/checkout@v4',
        pinned: RECORDED_SHA,
        checked: CHECKED_SHA,
        kind: 'kept-commit',
      },
    ])
  })

  it('accepts a reference pinned under the new name of its repository at the checked commit, but not at another one', () => {
    let renamedSha = 'b4ffde65f46336ab88eb53be808477a3936bae11'

    expect(
      findPinMismatches(
        [
          makeUpdate(
            { latestSha: renamedSha, targetRef: 'v2' },
            { name: 'my-org/old-name' },
          ),
          makeUpdate({}, { name: 'my-org/moved' }),
        ],
        {
          pins: [
            makePin('my-org/new-name', 'v2', renamedSha),
            makePin('my-org/other', 'v4', RECORDED_SHA),
          ],
          refusals: [],
        },
        new Map([['my-org/other@v4', RECORDED_SHA]]),
      ),
    ).toStrictEqual([{ reference: 'my-org/moved@v4', kind: 'missing' }])
  })

  it('reports a reference the lockfile does not pin, once however many updates wrote it', () => {
    expect(
      findPinMismatches(
        [
          makeUpdate(
            { latestSha: UPLOAD_SHA },
            { name: 'actions/upload-artifact' },
          ),
          makeUpdate(
            { latestSha: UPLOAD_SHA },
            {
              file: '/repo/.github/workflows/release.yml',
              name: 'actions/upload-artifact',
            },
          ),
        ],
        {
          pins: [makePin('actions/checkout', 'v4', CHECKED_SHA)],
          refusals: [],
        },
        new Map(),
      ),
    ).toStrictEqual([
      { reference: 'actions/upload-artifact@v4', kind: 'missing' },
    ])
  })

  it('accepts any pin of a reference whose checked commit is unknown, but not a missing one', () => {
    expect(
      findPinMismatches(
        [
          makeUpdate({ latestSha: null }),
          makeUpdate({ latestSha: null }, { name: 'actions/cache' }),
        ],
        {
          pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
          refusals: [],
        },
        new Map(),
      ),
    ).toStrictEqual([{ reference: 'actions/cache@v4', kind: 'missing' }])
  })

  it('reports each workflow a written reference was refused for, though another workflow pins it', () => {
    let release = '.github/workflows/release.yml'
    let deploy = '.github/workflows/deploy.yml'

    expect(
      findPinMismatches(
        [
          makeUpdate(),
          makeUpdate({}, { file: '/repo/.github/workflows/release.yml' }),
          makeUpdate({}, { name: 'actions/upload-artifact' }),
          makeUpdate({}, { name: 'actions/cache' }),
        ],
        {
          refusals: [
            makeRefusal(release, 'actions/checkout'),
            makeRefusal(release, 'actions/checkout'),
            makeRefusal(deploy, 'actions/checkout'),
            makeRefusal(release, 'actions/upload-artifact'),
            makeRefusal(release, 'actions/cache'),
            makeRefusal(release, 'actions/setup-node'),
          ],
          pins: [
            makePin('actions/checkout', 'v4', CHECKED_SHA),
            makePin('actions/cache', 'v4', RECORDED_SHA),
          ],
        },
        new Map(),
      ),
    ).toStrictEqual([
      {
        reference: 'actions/checkout@v4',
        workflow: release,
        kind: 'refused',
      },
      {
        reference: 'actions/checkout@v4',
        workflow: deploy,
        kind: 'refused',
      },
      {
        reference: 'actions/upload-artifact@v4',
        workflow: release,
        kind: 'refused',
      },
      { reference: 'actions/cache@v4', workflow: release, kind: 'refused' },
      {
        reference: 'actions/cache@v4',
        pinned: RECORDED_SHA,
        kind: 'other-commit',
        checked: CHECKED_SHA,
      },
    ])
  })

  it('skips an update that names no reference or no repository', () => {
    expect(
      findPinMismatches(
        [
          makeUpdate({ targetRef: null, latestSha: null }),
          makeUpdate({}, { name: 'checkout' }),
        ],
        { refusals: [], pins: [] },
        new Map(),
      ),
    ).toStrictEqual([])
  })
})
