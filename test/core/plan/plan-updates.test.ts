import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubAction } from '../../../types/github-action'
import type { GitHubClient } from '../../../types/github-client'
import type { ScanResult } from '../../../types/scan-result'

import { createGitHubClient } from '../../../core/api/create-github-client'
import { findRepositoryRoot } from '../../../core/fs/find-repository-root'
import { scanGitHubActions } from '../../../core/scan-github-actions'
import { createMockClient } from '../../helpers/create-mock-client'
import { shouldIgnore } from '../../../core/ignore/should-ignore'
import { checkUpdates } from '../../../core/api/check-updates'
import { planUpdates } from '../../../core/plan/plan-updates'
import { scanRecursive } from '../../../core/scan-recursive'

vi.mock(import('../../../core/runners/known-runner-labels'), () => ({
  KNOWN_RUNNER_IMAGES: {
    ubuntu: [{ version: '22.04' }, { version: '24.04' }],
    windows: [{ version: '2025' }],
    macos: [{ version: '15' }],
  },
}))
vi.mock(import('../../../core/api/create-github-client'))
vi.mock(import('../../../core/fs/find-repository-root'))
vi.mock(import('../../../core/ignore/should-ignore'))
vi.mock(import('../../../core/scan-github-actions'))
vi.mock(import('../../../core/api/check-updates'))
vi.mock(import('../../../core/scan-recursive'))

const NOW = '2026-10-03T12:00:00.000Z'

const RELEASED_LONG_AGO = '2026-08-01T00:00:00.000Z'

const RELEASED_AN_HOUR_AGO = '2026-10-03T11:00:00.000Z'

const LATEST_SHA = 'b4ffde65f46336ab88eb53be808477a3936bae11'

const ON_BRANCH_SINCE = '2026-07-15T00:00:00.000Z'

const WORKFLOW_FILE = '/repo/.github/workflows/ci.yml'

/**
 * Lets the scan find the actions of the given updates plus the runners, and
 * lets the update check answer with the updates of the actions it is asked
 * about.
 *
 * @param updates - Update check answers, one per scanned action.
 * @param runners - Scanned runner labels.
 */
function arrangeRun(
  updates: ActionUpdate[],
  runners: GitHubAction[] = [],
): void {
  let scanResult = makeScanResult([
    ...updates.map(update => update.action),
    ...runners,
  ])
  vi.mocked(scanGitHubActions).mockResolvedValue(scanResult)
  vi.mocked(scanRecursive).mockResolvedValue(scanResult)
  vi.mocked(checkUpdates).mockImplementation(actions =>
    Promise.resolve(updates.filter(update => actions.includes(update.action))),
  )
}

/**
 * Update check answer for an action: a newer, long published major release.
 *
 * @param action - Scanned action the answer belongs to.
 * @param overrides - Fields to replace.
 * @returns Update found by the update check.
 */
function makeUpdate(
  action: GitHubAction,
  overrides: Partial<ActionUpdate> = {},
): ActionUpdate {
  return {
    publishedAt: new Date(RELEASED_LONG_AGO),
    currentVersion: action.version ?? null,
    latestVersion: 'v4.2.2',
    currentRefType: 'tag',
    latestSha: LATEST_SHA,
    isBreaking: true,
    hasUpdate: true,
    status: 'ok',
    action,
    ...overrides,
  }
}

/**
 * Client of repositories whose default branch holds every commit, and held it
 * long before any cool-down of the tests started.
 *
 * @returns Mocked client.
 */
function createClientOfReachableCommits(): GitHubClient {
  return createMockClient({
    getBranchTipAt: vi.fn<GitHubClient['getBranchTipAt']>().mockResolvedValue({
      sha: 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a',
      since: new Date(ON_BRANCH_SINCE),
    }),
    compareCommits: vi
      .fn<GitHubClient['compareCommits']>()
      .mockResolvedValue('behind'),
  })
}

/**
 * Action reference as the scanner reports it.
 *
 * @param overrides - Fields to replace.
 * @returns Scanned action reference to `actions/checkout@v3`.
 */
function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    name: 'actions/checkout',
    file: WORKFLOW_FILE,
    type: 'external',
    version: 'v3',
    line: 14,
    ...overrides,
  }
}

/**
 * Scan result holding the given entries in one workflow.
 *
 * @param entries - Scanned actions and runners.
 * @returns Scan result with a single workflow that holds every entry.
 */
function makeScanResult(entries: GitHubAction[]): ScanResult {
  return {
    workflows: new Map([['.github/workflows/ci.yml', entries]]),
    compositeActions: new Map(),
    actions: entries,
  }
}

describe('planUpdates', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    vi.spyOn(process, 'cwd').mockReturnValue('/repo')
    vi.mocked(findRepositoryRoot).mockResolvedValue('/repo')
    vi.mocked(shouldIgnore).mockResolvedValue(false)
    vi.mocked(createGitHubClient).mockReturnValue(
      createClientOfReachableCommits(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('plans the updates of the .github directory of the working directory with the CLI defaults', async () => {
    let action = makeAction()
    arrangeRun([makeUpdate(action)])

    let plan = await planUpdates()

    expect(plan).toStrictEqual({
      updates: [
        {
          ...makeUpdate(action),
          effectiveDate: new Date(ON_BRANCH_SINCE),
          targetRefRateLimited: undefined,
          immutableRelease: false,
          targetRefStyle: 'sha',
          targetRef: LATEST_SHA,
          ageSource: 'branch',
          trustHolds: [],
        },
      ],
      status: 'updates-available',
      blockedAsDowngrade: [],
      blockedByTrust: [],
      blockedByMode: [],
      actionsChecked: 1,
      blockedByAge: [],
      skipped: [],
      runners: [],
    })
    expect(scanGitHubActions).toHaveBeenCalledExactlyOnceWith(
      '/repo',
      '.github',
    )
    expect(checkUpdates).toHaveBeenCalledExactlyOnceWith([action], undefined, {
      client: vi.mocked(createGitHubClient).mock.results[0]?.value as unknown,
      includeBranches: false,
      preferTags: false,
      style: 'sha',
    })
  })

  it('holds back a release published within the default cool-down of a day', async () => {
    let action = makeAction()
    let update = makeUpdate(action, {
      publishedAt: new Date(RELEASED_AN_HOUR_AGO),
    })
    arrangeRun([update])

    let plan = await planUpdates()

    expect(plan).toMatchObject({
      blockedByAge: [{ ...update, holdReason: 'cool-down' }],
      status: 'up-to-date',
      updates: [],
    })
  })

  it('applies the given policy the way the matching CLI flags do', async () => {
    let checkout = makeAction()
    let setupNode = makeAction({ name: 'actions/setup-node', line: 20 })
    let runner: GitHubAction = {
      version: 'ubuntu-22.04',
      name: 'runner/ubuntu',
      file: WORKFLOW_FILE,
      type: 'runner',
      line: 9,
    }
    arrangeRun(
      [
        makeUpdate(checkout, { publishedAt: new Date(RELEASED_AN_HOUR_AGO) }),
        makeUpdate(setupNode),
      ],
      [runner],
    )

    let plan = await planUpdates({
      minAgeExclude: [String.raw`/^ACTIONS\//i`],
      exclude: ['^actions/setup-node$'],
      directories: ['.github', 'ci'],
      token: 'explicit-token',
      includeBranches: true,
      style: 'preserve',
      preferTags: true,
      mode: 'major',
      minAge: 7,
    })

    expect(plan).toMatchObject({
      runners: [{ targetRef: 'ubuntu-24.04', action: runner }],
      updates: [{ action: checkout }],
      status: 'updates-available',
      actionsChecked: 1,
    })
    expect(vi.mocked(scanGitHubActions).mock.calls).toStrictEqual([
      ['/repo', '.github'],
      ['/repo', 'ci'],
    ])
    expect(createGitHubClient).toHaveBeenCalledExactlyOnceWith('explicit-token')
    expect(checkUpdates).toHaveBeenCalledExactlyOnceWith(
      [checkout],
      'explicit-token',
      expect.objectContaining({
        includeBranches: true,
        style: 'preserve',
        preferTags: true,
      }),
    )
  })

  it('holds runner updates back outside the major mode', async () => {
    let runner: GitHubAction = {
      version: 'ubuntu-22.04',
      name: 'runner/ubuntu',
      file: WORKFLOW_FILE,
      type: 'runner',
      line: 9,
    }
    arrangeRun([], [runner])

    let plan = await planUpdates({ mode: 'minor' })

    expect(plan).toMatchObject({
      blockedByMode: [{ action: runner }],
      status: 'up-to-date',
      runners: [],
    })
  })

  it('scans recursively from the working directory when asked to', async () => {
    arrangeRun([makeUpdate(makeAction())])

    await planUpdates({ recursive: true })

    expect(scanRecursive).toHaveBeenCalledExactlyOnceWith('/repo', '.')
    expect(findRepositoryRoot).not.toHaveBeenCalled()
  })

  it('scans from the given working directory', async () => {
    vi.mocked(findRepositoryRoot).mockResolvedValue('/elsewhere')
    arrangeRun([makeUpdate(makeAction())])

    await planUpdates({ cwd: '/elsewhere' })

    expect(findRepositoryRoot).toHaveBeenCalledExactlyOnceWith('/elsewhere')
    expect(scanGitHubActions).toHaveBeenCalledExactlyOnceWith(
      '/elsewhere',
      '.github',
    )
  })

  it('reports a repository without actions without checking anything', async () => {
    arrangeRun([])

    let plan = await planUpdates()

    expect(plan).toStrictEqual({
      status: 'no-actions-found',
      blockedAsDowngrade: [],
      blockedByTrust: [],
      blockedByMode: [],
      actionsChecked: 0,
      blockedByAge: [],
      skipped: [],
      updates: [],
      runners: [],
    })
    expect(checkUpdates).not.toHaveBeenCalled()
  })

  it('reports a repository whose every entry is excluded without checking anything', async () => {
    arrangeRun([makeUpdate(makeAction())])

    let plan = await planUpdates({ exclude: ['checkout'] })

    expect(plan).toMatchObject({
      status: 'nothing-to-check',
      actionsChecked: 0,
    })
    expect(checkUpdates).not.toHaveBeenCalled()
  })

  it.each([
    { message: 'Invalid minAge "-1".', options: { minAge: -1 } },
    {
      message: 'Invalid minAge "NaN".',
      options: { minAge: Number.NaN },
    },
    {
      options: { mode: 'breaking' as 'major' },
      message: 'Invalid mode "breaking".',
    },
    {
      options: { style: 'tag' as 'sha' },
      message: 'Invalid style "tag".',
    },
  ])('rejects $options before scanning', async ({ options, message }) => {
    await expect(planUpdates(options)).rejects.toThrow(message)
    expect(scanGitHubActions).not.toHaveBeenCalled()
  })
})
