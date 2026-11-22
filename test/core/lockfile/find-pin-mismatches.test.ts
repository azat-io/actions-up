import { describe, expect, it } from 'vitest'
import { relative } from 'node:path'

import type { RelockTarget } from '../../../types/relock-target'
import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'
import type { PinMismatch } from '../../../types/pin-mismatch'
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
 * Fields of an update to replace; the action is merged field by field.
 */
interface UpdateOverrides extends Partial<Omit<ActionUpdate, 'action'>> {
  /**
   * Fields of the action to replace.
   */
  action?: Partial<GitHubAction>
}

/**
 * Create a written update of a locked action of the CI workflow to `v4`.
 *
 * @param overrides - Fields to replace.
 * @returns Update the writer wrote.
 */
function makeUpdate(overrides: UpdateOverrides = {}): ActionUpdate {
  let { action, ...update } = overrides
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
    ...update,
  }
}

/**
 * Lockfile on disk that records every reported pin for every workflow the
 * lockfile was regenerated for, as a release that writes what it reports does.
 *
 * @param target - What the lockfile was regenerated for.
 * @param pins - What gh-actions-lock reported as pinned.
 * @returns What the lockfile records on disk.
 */
function writtenAs(
  target: Pick<RelockTarget, 'files'>,
  pins: LockPin[],
): { commits: Map<string, string>; pins: Map<string, string[]> } {
  let keys = pins.map(pin => `${pin.repository}@${pin.ref}`)
  return {
    pins: new Map(
      target.files
        .values()
        .flatMap(workflows => workflows.map(workflow => [workflow, keys])),
    ),
    commits: new Map(
      pins.map(pin => [`${pin.repository}@${pin.ref}`, pin.sha]),
    ),
  }
}

/**
 * Find the mismatches of a regenerated lockfile that records on disk what
 * gh-actions-lock reported.
 *
 * @param target - What the lockfile was regenerated for.
 * @param relocked - What gh-actions-lock reported.
 * @param recorded - Commits the lockfile pinned before the relock.
 * @returns What is not pinned as checked.
 */
function findMismatches(
  target: Pick<RelockTarget, 'updates' | 'files'>,
  relocked: { refusals: LockRefusal[]; pins: LockPin[] },
  recorded: Map<string, string>,
): PinMismatch[] {
  return findPinMismatches(target, relocked, {
    written: writtenAs(target, relocked.pins),
    recorded,
  })
}

/**
 * What a lockfile was regenerated for: the given updates, each written to a
 * workflow the lockfile records under its own key.
 *
 * @param updates - What the writer applied, in order.
 * @returns The updates, with the files they were written to.
 */
function writtenBy(
  ...updates: ActionUpdate[]
): Pick<RelockTarget, 'updates' | 'files'> {
  return {
    files: new Map(
      updates.map(({ action }) => [
        action.file!,
        [relative('/repo', action.file!)],
      ]),
    ),
    updates,
  }
}

/**
 * Reference the relock refused to pin for a workflow.
 *
 * @param workflow - Workflow, relative to the repository root.
 * @param repository - Repository, `owner/repo`.
 * @returns What gh-actions-lock reports for the workflow.
 */
function makeRefusal(workflow: string, repository: string): LockRefusal {
  return { dependency: `${repository}@v4`, repository, ref: 'v4', workflow }
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

describe('findPinMismatches', () => {
  it('finds nothing when every written reference is pinned to the checked commit', () => {
    let setupNodeSha = '49933ea5288caeca8642d1e84afbd3f7d6820020'

    expect(
      findMismatches(
        writtenBy(
          makeUpdate({ action: { name: 'Actions/Checkout' } }),
          makeUpdate({
            action: { name: 'actions/setup-node' },
            latestSha: setupNodeSha.toUpperCase(),
            targetRef: setupNodeSha,
            targetRefStyle: 'sha',
          }),
          makeUpdate({ action: { name: 'github/codeql-action/init' } }),
        ),
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
        findMismatches(
          writtenBy(makeUpdate()),
          {
            pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
            refusals: [],
          },
          recorded,
        ),
      ).toStrictEqual([
        {
          workflows: ['.github/workflows/ci.yml'],
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
      findMismatches(
        writtenBy(makeUpdate()),
        {
          pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
          refusals: [],
        },
        new Map([['actions/checkout@v4', RECORDED_SHA]]),
      ),
    ).toStrictEqual([
      {
        workflows: ['.github/workflows/ci.yml'],
        reference: 'actions/checkout@v4',
        pinned: RECORDED_SHA,
        checked: CHECKED_SHA,
        kind: 'kept-commit',
      },
    ])
  })

  it('reports a reference whose pin moved from a third commit the lockfile recorded for it as moved, not as kept', () => {
    expect(
      findMismatches(
        writtenBy(makeUpdate()),
        {
          pins: [makePin('actions/checkout', 'v4', RECORDED_SHA)],
          refusals: [],
        },
        new Map([['actions/checkout@v4', UPLOAD_SHA]]),
      ),
    ).toStrictEqual([
      {
        workflows: ['.github/workflows/ci.yml'],
        reference: 'actions/checkout@v4',
        kind: 'other-commit',
        pinned: RECORDED_SHA,
        checked: CHECKED_SHA,
      },
    ])
  })

  it('does not take a pin of another reference at the checked commit for the written one', () => {
    expect(
      findMismatches(
        writtenBy(makeUpdate()),
        {
          pins: [makePin('actions/checkout', 'v4.3.1', CHECKED_SHA)],
          refusals: [],
        },
        new Map(),
      ),
    ).toStrictEqual([{ reference: 'actions/checkout@v4', kind: 'missing' }])
  })

  it('accepts a reference pinned under the new name of its repository at the checked commit, but not at another one', () => {
    let renamedSha = 'b4ffde65f46336ab88eb53be808477a3936bae11'

    expect(
      findMismatches(
        writtenBy(
          makeUpdate({
            action: { name: 'my-org/old-name' },
            latestSha: renamedSha,
            targetRef: 'v2',
          }),
          makeUpdate({ action: { name: 'my-org/moved' } }),
        ),
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
      findMismatches(
        writtenBy(
          makeUpdate({
            action: { name: 'actions/upload-artifact' },
            latestSha: UPLOAD_SHA,
          }),
          makeUpdate({
            action: {
              file: '/repo/.github/workflows/release.yml',
              name: 'actions/upload-artifact',
            },
            latestSha: UPLOAD_SHA,
          }),
        ),
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
      findMismatches(
        writtenBy(
          makeUpdate({ latestSha: null }),
          makeUpdate({ action: { name: 'actions/cache' }, latestSha: null }),
        ),
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
    let setup = '/repo/.github/actions/setup/action.yml'
    let updates = [
      makeUpdate(),
      makeUpdate({ action: { file: setup } }),
      makeUpdate({ action: { name: 'actions/upload-artifact', file: setup } }),
      makeUpdate({ action: { name: 'actions/cache', file: setup } }),
    ]

    expect(
      findMismatches(
        {
          files: new Map([
            ['/repo/.github/workflows/ci.yml', ['.github/workflows/ci.yml']],
            [setup, [release, deploy]],
          ]),
          updates,
        },
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
        workflows: [deploy, release],
        pinned: RECORDED_SHA,
        kind: 'other-commit',
        checked: CHECKED_SHA,
      },
    ])
  })

  it('counts a refusal only for a workflow the reference was written for, since the entry of another one was stale before', () => {
    let release = '.github/workflows/release.yml'

    expect(
      findMismatches(
        writtenBy(
          makeUpdate(),
          makeUpdate({
            action: { name: 'actions/upload-artifact' },
            latestSha: UPLOAD_SHA,
          }),
          makeUpdate({
            action: {
              file: '/repo/.github/workflows/release.yml',
              name: 'actions/setup-node',
            },
          }),
        ),
        {
          pins: [
            makePin('actions/checkout', 'v4', CHECKED_SHA),
            makePin('actions/setup-node', 'v4', CHECKED_SHA),
          ],
          refusals: [
            makeRefusal(release, 'actions/checkout'),
            makeRefusal(release, 'actions/upload-artifact'),
          ],
        },
        new Map(),
      ),
    ).toStrictEqual([
      { reference: 'actions/upload-artifact@v4', kind: 'missing' },
    ])
  })

  it('reports a refused reference that no workflow pins as refused alone', () => {
    expect(
      findMismatches(
        writtenBy(makeUpdate()),
        {
          refusals: [
            makeRefusal('.github/workflows/ci.yml', 'actions/checkout'),
          ],
          pins: [],
        },
        new Map(),
      ),
    ).toStrictEqual([
      {
        workflow: '.github/workflows/ci.yml',
        reference: 'actions/checkout@v4',
        kind: 'refused',
      },
    ])
  })

  it('matches a refusal with the reference whatever case the workflow names its repository in', () => {
    expect(
      findMismatches(
        writtenBy(makeUpdate({ action: { name: 'Actions/Checkout' } })),
        {
          refusals: [
            makeRefusal('.github/workflows/ci.yml', 'actions/checkout'),
          ],
          pins: [makePin('actions/checkout', 'v4', CHECKED_SHA)],
        },
        new Map(),
      ),
    ).toStrictEqual([
      {
        workflow: '.github/workflows/ci.yml',
        reference: 'Actions/Checkout@v4',
        kind: 'refused',
      },
    ])
  })

  it('counts a refusal for the workflows of every file a reference was written to, the first one included', () => {
    let release = '/repo/.github/workflows/release.yml'

    expect(
      findMismatches(
        writtenBy(makeUpdate(), makeUpdate({ action: { file: release } })),
        {
          refusals: [
            makeRefusal('.github/workflows/ci.yml', 'actions/checkout'),
          ],
          pins: [makePin('actions/checkout', 'v4', CHECKED_SHA)],
        },
        new Map(),
      ),
    ).toStrictEqual([
      {
        workflow: '.github/workflows/ci.yml',
        reference: 'actions/checkout@v4',
        kind: 'refused',
      },
    ])
  })

  it('reports a reference gh-actions-lock reported as pinned that the lockfile on disk does not record for a workflow, or records at another commit', () => {
    let release = '/repo/.github/workflows/release.yml'
    let setup = '/repo/.github/actions/setup/action.yml'

    expect(
      findPinMismatches(
        {
          files: new Map([
            [
              setup,
              ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'],
            ],
            ['/repo/.github/workflows/ci.yml', ['.github/workflows/ci.yml']],
            [release, ['.github/workflows/release.yml']],
          ]),
          updates: [
            makeUpdate(),
            makeUpdate({ action: { file: release } }),
            makeUpdate({
              action: { name: 'actions/upload-artifact', file: setup },
              latestSha: UPLOAD_SHA,
            }),
          ],
        },
        {
          pins: [
            makePin('actions/checkout', 'v4', CHECKED_SHA),
            makePin('actions/upload-artifact', 'v4', UPLOAD_SHA),
          ],
          refusals: [],
        },
        {
          written: {
            pins: new Map([
              [
                '.github/workflows/ci.yml',
                ['actions/checkout@v4', 'actions/upload-artifact@v4'],
              ],
              ['.github/workflows/deploy.yml', ['actions/upload-artifact@v4']],
            ]),
            commits: new Map([
              ['actions/upload-artifact@v4', RECORDED_SHA],
              ['actions/checkout@v4', CHECKED_SHA],
            ]),
          },
          recorded: new Map(),
        },
      ),
    ).toStrictEqual([
      {
        workflow: '.github/workflows/release.yml',
        reference: 'actions/checkout@v4',
        kind: 'not-on-disk',
      },
      {
        reference: 'actions/upload-artifact@v4',
        workflow: '.github/workflows/ci.yml',
        kind: 'not-on-disk',
      },
      {
        workflow: '.github/workflows/deploy.yml',
        reference: 'actions/upload-artifact@v4',
        kind: 'not-on-disk',
      },
    ])
  })

  it('accepts a reference the lockfile on disk records under the new name of its repository at the checked commit, but not at another one', () => {
    let renamedSha = 'b4ffde65f46336ab88eb53be808477a3936bae11'
    let relocked = {
      pins: [
        makePin('my-org/new-name', 'v2', renamedSha),
        makePin('my-org/new-tool', 'v4', CHECKED_SHA),
      ],
      refusals: [],
    }
    let target = writtenBy(
      makeUpdate({
        action: { name: 'my-org/old-name' },
        latestSha: renamedSha,
        targetRef: 'v2',
      }),
      makeUpdate({ action: { name: 'my-org/old-tool' } }),
    )

    expect(
      findPinMismatches(target, relocked, {
        written: {
          pins: new Map([
            [
              '.github/workflows/ci.yml',
              ['my-org/new-name@v2', 'my-org/new-tool@v4'],
            ],
          ]),
          commits: new Map([
            ['my-org/new-tool@v4', RECORDED_SHA],
            ['my-org/new-name@v2', renamedSha],
          ]),
        },
        recorded: new Map(),
      }),
    ).toStrictEqual([
      {
        workflow: '.github/workflows/ci.yml',
        reference: 'my-org/old-tool@v4',
        kind: 'not-on-disk',
      },
    ])
  })

  it('does not report on disk a reference already reported as refused or as missing', () => {
    let release = '/repo/.github/workflows/release.yml'

    expect(
      findPinMismatches(
        writtenBy(
          makeUpdate(),
          makeUpdate({ action: { file: release } }),
          makeUpdate({
            action: { name: 'actions/cache' },
            latestSha: UPLOAD_SHA,
          }),
        ),
        {
          refusals: [
            makeRefusal('.github/workflows/release.yml', 'actions/checkout'),
          ],
          pins: [makePin('actions/checkout', 'v4', CHECKED_SHA)],
        },
        {
          written: {
            pins: new Map([
              ['.github/workflows/ci.yml', ['actions/checkout@v4']],
            ]),
            commits: new Map([['actions/checkout@v4', CHECKED_SHA]]),
          },
          recorded: new Map(),
        },
      ),
    ).toStrictEqual([
      {
        workflow: '.github/workflows/release.yml',
        reference: 'actions/checkout@v4',
        kind: 'refused',
      },
      { reference: 'actions/cache@v4', kind: 'missing' },
    ])
  })

  it('skips an update that names no reference or no repository', () => {
    expect(
      findMismatches(
        writtenBy(
          makeUpdate({ targetRef: null, latestSha: null }),
          makeUpdate({ action: { name: 'checkout' } }),
        ),
        { refusals: [], pins: [] },
        new Map(),
      ),
    ).toStrictEqual([])
  })
})
