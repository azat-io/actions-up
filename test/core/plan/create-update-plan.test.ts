import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { GitHubAction } from '../../../types/github-action'
import type { RouteAnswer } from '../../helpers/route-fetch'
import type { ScanResult } from '../../../types/scan-result'

import {
  makeRepositoryPayload,
  makeComparisonPayload,
  makeReferencePayload,
  makeTagListingEntry,
  branchUpdatesPage,
  makeBranchPayload,
  makeBranchUpdate,
  makeTagRelease,
  serverError,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { createUpdatePlan } from '../../../core/plan/create-update-plan'
import { shouldIgnore } from '../../../core/ignore/should-ignore'

vi.mock(import('../../../core/ignore/should-ignore'))

const NOW = '2026-10-03T12:00:00.000Z'

const TWO_YEARS_AGO = '2024-10-03T12:00:00Z'

const AN_HOUR_AGO = '2026-10-03T11:00:00Z'

/**
 * Moment `main` moved to the tip it still had at the start of the cool-down, a
 * day before `NOW`.
 */
const TIP_SINCE = '2026-09-20T09:00:00Z'

/**
 * Tip of `main` at the start of the cool-down.
 */
const TIP_AT_CUTOFF = 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a'

/**
 * Tip of `main` now, pushed inside the cool-down.
 */
const CURRENT_TIP = '9d5bc5a87f6a0e9f2aa4e5ec0bbd4d1e9a6b2c11'

const RELEASE_SHA = '11bd71901bbe5b1630ceea73d27597364c9af683'

const OLDER_SHA = '692973e3d937129bcbf40652eb9f2f61becf3332'

/**
 * Commit the hijacked tags point at.
 */
const MALICIOUS_SHA = '0e58ed8671d6b60d0890c21b07f8835ace038e67'

const REPOSITORY = '/repos/actions/checkout'

const LATEST_RELEASE_PATH = `${REPOSITORY}/releases/latest`

const REFERENCE_PATH = `${REPOSITORY}/git/ref/tags/v4.2.2`

const PROTECTED_BRANCHES_PATH = `${REPOSITORY}/branches?protected=true&per_page=100`

/**
 * Routes of the history of `main`, which moved to `TIP_AT_CUTOFF` before the
 * cool-down and to `CURRENT_TIP` inside it, and of the comparisons of commits
 * with both tips.
 *
 * @param statuses - Status of each commit compared, relative to the tip at the
 *   start of the cool-down and to the branch now; a status left out answers
 *   that the two share no history.
 * @returns Answers keyed by API path.
 */
function mainHistoryRoutes(
  statuses: Record<
    string,
    { atCutoff?: RouteAnswer; now?: RouteAnswer } | undefined
  >,
): Record<string, RouteAnswer> {
  let routes: Record<string, RouteAnswer> = {
    [branchHistoryPath('main')]: branchUpdatesPage([
      makeBranchUpdate({
        timestamp: AN_HOUR_AGO,
        before: TIP_AT_CUTOFF,
        after: CURRENT_TIP,
      }),
      makeBranchUpdate({
        before: '83ec2a7a1e54a2bb4b9e3b8d2a3df6a0a1c1c0a5',
        timestamp: TIP_SINCE,
        after: TIP_AT_CUTOFF,
      }),
    ]),
  }

  for (let [sha, status] of Object.entries(statuses)) {
    routes[tipComparisonPath(sha)] = status?.atCutoff ?? notFound()
    routes[comparisonPath(sha)] = status?.now ?? notFound()
  }

  return routes
}

/**
 * Routes of `actions/checkout` whose latest release `v4.2.2` points at the
 * given commit through a lightweight tag.
 *
 * @param release - Release and commit of the tag.
 * @param release.publishedAt - Publication date of the release.
 * @param release.sha - Commit the tag points at.
 * @param release.immutable - Whether the release is immutable.
 * @param release.targetCommitish - Target the release names.
 * @returns Routes of the release, its tag and the repository.
 */
function latestReleaseRoutes(release: {
  targetCommitish?: string
  immutable?: boolean
  publishedAt: string
  sha: string
}): Record<string, RouteAnswer> {
  let { targetCommitish, publishedAt, immutable, sha } = release
  return {
    [LATEST_RELEASE_PATH]: ok(
      makeTagRelease('v4.2.2', publishedAt, { targetCommitish, immutable }),
    ),
    [REFERENCE_PATH]: ok(
      makeReferencePayload('refs/tags/v4.2.2', { type: 'commit', sha }),
    ),
    [REPOSITORY]: ok(makeRepositoryPayload('main')),
  }
}

/**
 * Plan the updates of the given actions with the CLI defaults: SHA pins, the
 * major mode and a cool-down of one day.
 *
 * @param actions - Scanned actions.
 * @param options - Policy that differs from the defaults.
 * @returns Updates that can be written and the entries left out.
 */
function plan(
  actions: GitHubAction[],
  options: Partial<Parameters<typeof createUpdatePlan>[1]> = {},
): ReturnType<typeof createUpdatePlan> {
  return createUpdatePlan(makeScanResult(actions), {
    includeBranches: false,
    token: 'test-token',
    minAgeExcludes: [],
    preferTags: false,
    mode: 'major',
    style: 'sha',
    excludes: [],
    minAge: 1,
    ...options,
  })
}

/**
 * Action reference as the scanner reports it.
 *
 * @param overrides - Fields to replace.
 * @returns Scanned reference to `actions/checkout@v4.0.0`.
 */
function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    file: '/repo/.github/workflows/ci.yml',
    name: 'actions/checkout',
    version: 'v4.0.0',
    type: 'external',
    line: 14,
    ...overrides,
  }
}

/**
 * Tag listing the step-down walks, newest first.
 *
 * @param tags - Tag names with their commits.
 * @returns Route of the listing.
 */
function walkListing(tags: [string, string][]): Record<string, RouteAnswer> {
  return {
    [`${REPOSITORY}/tags?per_page=100`]: ok(
      tags.map(([name, sha]) => makeTagListingEntry(name, sha)),
    ),
  }
}

/**
 * Scan result holding the given actions in one workflow.
 *
 * @param actions - Scanned actions.
 * @returns What a scan of the workflow reports.
 */
function makeScanResult(actions: GitHubAction[]): ScanResult {
  return {
    workflows: new Map([['.github/workflows/ci.yml', actions]]),
    compositeActions: new Map(),
    actions,
  }
}

/**
 * Recorded history of a branch, newest first.
 *
 * @param branch - Branch name.
 * @returns API path of the first page of the history.
 */
function branchHistoryPath(branch: string): string {
  return `${REPOSITORY}/activity?ref=${encodeURIComponent(`refs/heads/${branch}`)}&direction=desc&per_page=100`
}

/**
 * Comparison of a commit with the default branch now.
 *
 * @param sha - Commit to compare.
 * @returns API path that compares the commit with `main`.
 */
function comparisonPath(sha: string): string {
  return `${REPOSITORY}/compare/${encodeURIComponent('refs/heads/main')}...${sha}`
}

/**
 * Comparison of a commit with the tip `main` had at the start of the cool-down.
 *
 * @param sha - Commit to compare.
 * @returns API path of the comparison.
 */
function tipComparisonPath(sha: string): string {
  return `${REPOSITORY}/compare/${TIP_AT_CUTOFF}...${sha}`
}

/**
 * Answer of a comparison that finds the commit in the history of the base.
 *
 * @returns Route answer.
 */
function behind(): RouteAnswer {
  return ok(makeComparisonPayload('behind'))
}

/**
 * Answer of a comparison that finds the commit newer than the base.
 *
 * @returns Route answer.
 */
function ahead(): RouteAnswer {
  return ok(makeComparisonPayload('ahead'))
}

describe('createUpdatePlan', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    vi.mocked(shouldIgnore).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes an old release whose commit the default branch held at the start of the cool-down, with three more requests than the release lookup', async () => {
    let api = routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      ...mainHistoryRoutes({ [RELEASE_SHA]: { atCutoff: behind() } }),
    })

    let result = await plan([makeAction()])

    expect(result.updates).toMatchObject([
      {
        publishedAt: new Date(TWO_YEARS_AGO),
        effectiveDate: new Date(TIP_SINCE),
        immutableRelease: false,
        targetRef: RELEASE_SHA,
        latestSha: RELEASE_SHA,
        ageSource: 'branch',
        trustHolds: [],
      },
    ])
    expect(api.paths).toStrictEqual([
      LATEST_RELEASE_PATH,
      REFERENCE_PATH,
      REPOSITORY,
      branchHistoryPath('main'),
      tipComparisonPath(RELEASE_SHA),
    ])
  })

  describe('with a reference a workflow lockfile pins', () => {
    it('skips its update, which would leave the lockfile stale, and writes the others', async () => {
      routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: RELEASE_SHA,
        }),
        ...mainHistoryRoutes({ [RELEASE_SHA]: { atCutoff: behind() } }),
      })
      let locked = makeAction({ locked: true })
      let other = makeAction({
        file: '/repo/.github/workflows/release.yml',
        line: 6,
      })

      let result = await plan([locked, other])

      expect(result).toMatchObject({
        skipped: [
          {
            targetRef: RELEASE_SHA,
            skipReason: 'lockfile',
            status: 'skipped',
            hasUpdate: false,
            action: locked,
          },
        ],
        updates: [{ targetRef: RELEASE_SHA, action: other }],
      })
    })

    it('reports a tag that already names the latest version as unchecked, since the lockfile may pin an older commit of it', async () => {
      let api = routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: RELEASE_SHA,
        }),
        ...mainHistoryRoutes({ [RELEASE_SHA]: { atCutoff: behind() } }),
        [`${REPOSITORY}/git/ref/tags/v4`]: ok(
          makeReferencePayload('refs/tags/v4', {
            sha: RELEASE_SHA,
            type: 'commit',
          }),
        ),
      })
      let locked = makeAction({ version: 'v4', locked: true })

      let result = await plan(
        [locked, makeAction({ version: 'v4', line: 20 })],
        {
          style: 'semver',
        },
      )

      expect(result).toMatchObject({
        skipped: [
          {
            skipReason: 'lockfile-unchecked',
            status: 'skipped',
            hasUpdate: false,
            targetRef: 'v4',
            action: locked,
          },
        ],
        blockedByTrust: [],
        updates: [],
      })
      expect(api.paths).toContain(`${REPOSITORY}/git/ref/tags/v4`)
    })

    it('drops a commit pin that changes nothing, since the lockfile pins that very commit', async () => {
      routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: RELEASE_SHA,
        }),
        ...mainHistoryRoutes({ [RELEASE_SHA]: { atCutoff: behind() } }),
      })

      let result = await plan([
        makeAction({ version: RELEASE_SHA, comment: ' v4.2.1', locked: true }),
      ])

      expect(result).toMatchObject({
        blockedByTrust: [],
        updates: [],
        skipped: [],
      })
    })

    it('reports an update that stepped past a tag that failed a trust check as held back for that tag', async () => {
      routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: MALICIOUS_SHA,
        }),
        ...mainHistoryRoutes({
          [OLDER_SHA]: { atCutoff: behind() },
          [MALICIOUS_SHA]: undefined,
        }),
        ...walkListing([
          ['v4.2.2', MALICIOUS_SHA],
          ['v4.2.1', OLDER_SHA],
        ]),
        [`${REPOSITORY}/releases/tags/v4.2.1`]: ok(
          makeTagRelease('v4.2.1', '2024-09-01T12:00:00Z'),
        ),
        [PROTECTED_BRANCHES_PATH]: ok([]),
      })

      let result = await plan([makeAction({ locked: true })])

      expect(result).toMatchObject({
        blockedByTrust: [
          {
            holdReason: 'unreachable-commit',
            latestSha: MALICIOUS_SHA,
            latestVersion: 'v4.2.2',
          },
        ],
        updates: [],
        skipped: [],
      })
    })
  })

  it('checks a commit shared by actions of one repository once', async () => {
    let api = routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      ...mainHistoryRoutes({ [RELEASE_SHA]: { atCutoff: behind() } }),
    })

    let result = await plan([
      makeAction({ name: 'actions/checkout/init' }),
      makeAction({ name: 'actions/checkout/analyze', line: 20 }),
    ])

    expect(result.updates).toHaveLength(2)
    expect(api.paths).toHaveLength(5)
  })

  it('holds back an old release whose tag now points at a backdated commit pushed to the default branch inside the cool-down', async () => {
    routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: MALICIOUS_SHA,
      }),
      ...mainHistoryRoutes({
        [MALICIOUS_SHA]: { atCutoff: ahead(), now: behind() },
      }),
      ...walkListing([
        ['v4.2.2', MALICIOUS_SHA],
        ['v4.2.1', MALICIOUS_SHA],
        ['v4.1.0', MALICIOUS_SHA],
      ]),
      [`${REPOSITORY}/releases/tags/v4.2.1`]: ok(
        makeTagRelease('v4.2.1', '2024-09-01T12:00:00Z'),
      ),
      [`${REPOSITORY}/releases/tags/v4.1.0`]: ok(
        makeTagRelease('v4.1.0', '2024-06-01T12:00:00Z'),
      ),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      blockedByAge: [
        {
          publishedAt: new Date(TWO_YEARS_AGO),
          holdReason: 'cool-down',
          effectiveDate: null,
          ageSource: null,
        },
      ],
      status: 'up-to-date',
      blockedByTrust: [],
      updates: [],
    })
  })

  it('holds back a backdated commit that no branch of the repository contains', async () => {
    routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: MALICIOUS_SHA,
      }),
      ...walkListing([
        ['v4.2.2', MALICIOUS_SHA],
        ['v4.2.1', MALICIOUS_SHA],
      ]),
      ...mainHistoryRoutes({ [MALICIOUS_SHA]: undefined }),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      blockedByTrust: [
        {
          trustHolds: [
            {
              reason: 'unreachable-commit',
              sha: MALICIOUS_SHA,
              version: 'v4.2.2',
            },
          ],
          holdReason: 'unreachable-commit',
        },
      ],
      updates: [],
    })
  })

  it('holds back a commit the default branch held at the start of the cool-down but dropped with a force push since, as outside the history', async () => {
    routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: MALICIOUS_SHA,
      }),
      [branchHistoryPath('main')]: branchUpdatesPage([
        makeBranchUpdate({
          timestamp: '2026-10-02T12:05:00Z',
          activityType: 'force_push',
          before: MALICIOUS_SHA,
          after: CURRENT_TIP,
        }),
        makeBranchUpdate({
          timestamp: '2026-10-02T11:55:00Z',
          before: TIP_AT_CUTOFF,
          after: MALICIOUS_SHA,
        }),
      ]),
      [`${REPOSITORY}/compare/${MALICIOUS_SHA}...${MALICIOUS_SHA}`]: ok(
        makeComparisonPayload('identical'),
      ),
      ...walkListing([['v4.2.2', MALICIOUS_SHA]]),
      [comparisonPath(MALICIOUS_SHA)]: notFound(),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      blockedByTrust: [{ holdReason: 'unreachable-commit' }],
      updates: [],
    })
  })

  it('holds back an old release as undated when the default branch has no recorded update, whatever it holds now', async () => {
    routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      [branchHistoryPath('main')]: branchUpdatesPage([]),
      ...walkListing([['v4.2.2', RELEASE_SHA]]),
      [comparisonPath(RELEASE_SHA)]: behind(),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      blockedByAge: [{ holdReason: 'age-unknown', effectiveDate: null }],
      updates: [],
    })
  })

  it('writes an old release that reached the default branch inside the cool-down, dated by the protected branch it was cut on', async () => {
    let cutOnBranchAt = '2026-09-01T09:00:00Z'
    let api = routeFetch({
      [branchHistoryPath('releases/v4')]: branchUpdatesPage([
        makeBranchUpdate({
          reference: 'refs/heads/releases/v4',
          timestamp: cutOnBranchAt,
          after: RELEASE_SHA,
          before: OLDER_SHA,
        }),
      ]),
      ...mainHistoryRoutes({
        [RELEASE_SHA]: { atCutoff: ahead(), now: behind() },
      }),
      [`${REPOSITORY}/compare/${RELEASE_SHA}...${RELEASE_SHA}`]: ok(
        makeComparisonPayload('identical'),
      ),
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      [PROTECTED_BRANCHES_PATH]: ok([
        makeBranchPayload('releases/v4', RELEASE_SHA),
      ]),
    })

    let result = await plan([makeAction()])

    expect(result.updates).toMatchObject([
      {
        effectiveDate: new Date(cutOnBranchAt),
        targetRef: RELEASE_SHA,
        ageSource: 'branch',
      },
    ])
    expect(api.paths).toContain(branchHistoryPath('releases/v4'))
  })

  it('holds back a tag without a release as undated when the cool-down reaches back before the recorded history', async () => {
    let api = routeFetch({
      [`${REPOSITORY}/tags?per_page=30`]: ok([
        makeTagListingEntry('v4.1.0', RELEASE_SHA),
        makeTagListingEntry('v4.0.0', OLDER_SHA),
      ]),
      [`${REPOSITORY}/releases/tags/v4.1.0`]: notFound(),
      [`${REPOSITORY}/releases?per_page=1`]: ok([]),
      [comparisonPath(RELEASE_SHA)]: behind(),
      ...walkListing([['v4.1.0', RELEASE_SHA]]),
      [REPOSITORY]: ok(makeRepositoryPayload('main')),
      [PROTECTED_BRANCHES_PATH]: ok([]),
      [LATEST_RELEASE_PATH]: notFound(),
    })

    let result = await plan([makeAction()], { minAge: 1e9 })

    expect(result).toMatchObject({
      blockedByAge: [{ holdReason: 'age-unknown', effectiveDate: null }],
      updates: [],
    })
    expect(api.paths).not.toContain(branchHistoryPath('main'))
  })

  it('holds back a tag without a release whose commit reached the default branch inside the cool-down', async () => {
    routeFetch({
      ...mainHistoryRoutes({
        [RELEASE_SHA]: { atCutoff: ahead(), now: behind() },
      }),
      [`${REPOSITORY}/tags?per_page=30`]: ok([
        makeTagListingEntry('v4.1.0', RELEASE_SHA),
        makeTagListingEntry('v4.0.0', OLDER_SHA),
      ]),
      [`${REPOSITORY}/releases/tags/v4.1.0`]: notFound(),
      [`${REPOSITORY}/releases?per_page=1`]: ok([]),
      ...walkListing([['v4.1.0', RELEASE_SHA]]),
      [REPOSITORY]: ok(makeRepositoryPayload('main')),
      [PROTECTED_BRANCHES_PATH]: ok([]),
      [LATEST_RELEASE_PATH]: notFound(),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      blockedByAge: [
        {
          holdReason: 'cool-down',
          effectiveDate: null,
          publishedAt: null,
        },
      ],
      updates: [],
    })
  })

  describe('with an age that cannot be established', () => {
    /**
     * Routes of a repository without releases whose newest tag points at a
     * commit the default branch holds.
     *
     * @param overrides - Routes that fail.
     * @returns Answers keyed by API path.
     */
    function undatedTagRoutes(
      overrides: Record<string, RouteAnswer>,
    ): Record<string, RouteAnswer> {
      return {
        ...mainHistoryRoutes({
          [RELEASE_SHA]: { atCutoff: behind(), now: behind() },
        }),
        [`${REPOSITORY}/tags?per_page=30`]: ok([
          makeTagListingEntry('v4.1.0', RELEASE_SHA),
          makeTagListingEntry('v4.0.0', OLDER_SHA),
        ]),
        [`${REPOSITORY}/releases/tags/v4.1.0`]: notFound(),
        [REPOSITORY]: ok(makeRepositoryPayload('main')),
        [`${REPOSITORY}/releases?per_page=1`]: ok([]),
        [PROTECTED_BRANCHES_PATH]: ok([]),
        [LATEST_RELEASE_PATH]: notFound(),
        ...overrides,
      }
    }

    it.each([
      [
        'its release lookup fails',
        { [`${REPOSITORY}/releases/tags/v4.1.0`]: serverError() },
      ],
      [
        'the history of the default branch cannot be read',
        { [branchHistoryPath('main')]: serverError() },
      ],
    ])(
      'holds the update back with the cool-down on when %s',
      async (_case, overrides) => {
        routeFetch(undatedTagRoutes(overrides))

        let result = await plan([makeAction()])

        expect(result).toMatchObject({
          blockedByAge: [{ holdReason: 'age-unknown', effectiveDate: null }],
          updates: [],
        })
      },
    )

    it('writes the update with the cool-down off, once the default branch holds its commit', async () => {
      let api = routeFetch(
        undatedTagRoutes({
          [`${REPOSITORY}/releases/tags/v4.1.0`]: serverError(),
          [branchHistoryPath('main')]: serverError(),
        }),
      )

      let result = await plan([makeAction()], { minAge: 0 })

      expect(result).toMatchObject({
        updates: [{ targetRef: RELEASE_SHA, effectiveDate: null }],
        blockedByAge: [],
      })
      expect(api.paths).not.toContain(branchHistoryPath('main'))
    })
  })

  it('holds back a release whose publication date cannot be read', async () => {
    let release = ok(makeTagRelease('v4.2.2', 'not a date'))
    routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      ...mainHistoryRoutes({ [RELEASE_SHA]: { atCutoff: behind() } }),
      [`${REPOSITORY}/releases/tags/v4.2.2`]: release,
      [LATEST_RELEASE_PATH]: release,
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      blockedByAge: [
        { holdReason: 'age-unknown', effectiveDate: null, publishedAt: null },
      ],
      updates: [],
    })
  })

  it('reports a release whose tag lookup fails as unresolved, without taking the commit its release names', async () => {
    let api = routeFetch({
      ...latestReleaseRoutes({
        targetCommitish: MALICIOUS_SHA,
        publishedAt: TWO_YEARS_AGO,
        sha: RELEASE_SHA,
      }),
      [REFERENCE_PATH]: serverError(),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      skipped: [
        {
          skipReason: 'sha-unresolved',
          latestVersion: 'v4.2.2',
          status: 'skipped',
          latestSha: null,
        },
      ],
      updates: [],
    })
    expect(api.paths).toStrictEqual([LATEST_RELEASE_PATH, REFERENCE_PATH])
  })

  it('skips an update whose commit could not be checked against the history of the repository', async () => {
    routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      ...mainHistoryRoutes({
        [RELEASE_SHA]: {
          atCutoff: ok(makeComparisonPayload('diverged')),
          now: ok(makeComparisonPayload('diverged')),
        },
      }),
      [PROTECTED_BRANCHES_PATH]: serverError(),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      skipped: [{ skipReason: 'reachability-unknown', status: 'skipped' }],
      blockedByTrust: [],
      updates: [],
    })
  })

  describe('when the update mode sends the walk below the latest release', () => {
    /**
     * Routes of a repository whose latest release is a new major, with one
     * older release the minor mode would allow.
     *
     * @returns Answers keyed by API path.
     */
    function majorReleaseRoutes(): Record<string, RouteAnswer> {
      return {
        [`${REPOSITORY}/git/ref/tags/v5.0.0`]: ok(
          makeReferencePayload('refs/tags/v5.0.0', {
            sha: RELEASE_SHA,
            type: 'commit',
          }),
        ),
        [LATEST_RELEASE_PATH]: ok(makeTagRelease('v5.0.0', TWO_YEARS_AGO)),
        ...walkListing([
          ['v5.0.0', RELEASE_SHA],
          ['v4.3.0', OLDER_SHA],
        ]),
        [REPOSITORY]: ok(makeRepositoryPayload('main')),
      }
    }

    it('holds the update back when the date of the older release cannot be established', async () => {
      routeFetch({
        ...majorReleaseRoutes(),
        [`${REPOSITORY}/releases/tags/v4.3.0`]: serverError(),
      })

      let result = await plan([makeAction()], { mode: 'minor' })

      expect(result).toMatchObject({
        blockedByAge: [{ holdReason: 'age-unknown' }],
        blockedByMode: [],
        updates: [],
      })
    })

    it('skips the update when the commit of the older release cannot be checked', async () => {
      routeFetch({
        ...majorReleaseRoutes(),
        [comparisonPath(OLDER_SHA)]: serverError(),
        [PROTECTED_BRANCHES_PATH]: ok([]),
      })

      let result = await plan([makeAction()], { mode: 'minor', minAge: 0 })

      expect(result).toMatchObject({
        skipped: [{ skipReason: 'reachability-unknown' }],
        blockedByMode: [],
        updates: [],
      })
    })

    it('skips the update when the older tag cannot be resolved to a commit', async () => {
      routeFetch({
        [`${REPOSITORY}/git/matching-refs/tags/actions-`]: ok([
          makeReferencePayload('refs/tags/actions-v2.0.0', {
            sha: RELEASE_SHA,
            type: 'commit',
          }),
          makeReferencePayload('refs/tags/actions-v1.1.0', {
            sha: '057b2c5fe322260608f0764aa0674139c14d3b65',
            type: 'tag',
          }),
        ]),
        [`${REPOSITORY}/git/ref/tags/actions-v1.0.0`]: ok(
          makeReferencePayload('refs/tags/actions-v1.0.0', {
            type: 'commit',
            sha: OLDER_SHA,
          }),
        ),
        [`${REPOSITORY}/git/ref/tags/actions-v1.1.0`]: serverError(),
      })

      let result = await plan([makeAction({ version: 'actions-v1.0.0' })], {
        mode: 'minor',
      })

      expect(result).toMatchObject({
        skipped: [{ skipReason: 'sha-unresolved', status: 'skipped' }],
        blockedByMode: [],
        updates: [],
      })
    })
  })

  it('steps past the newest release when its commit is outside the history of the repository and writes the next one that passes', async () => {
    routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: MALICIOUS_SHA,
      }),
      ...mainHistoryRoutes({
        [OLDER_SHA]: { atCutoff: behind() },
        [MALICIOUS_SHA]: undefined,
      }),
      ...walkListing([
        ['v4.2.2', MALICIOUS_SHA],
        ['v4.2.1', OLDER_SHA],
      ]),
      [`${REPOSITORY}/releases/tags/v4.2.1`]: ok(
        makeTagRelease('v4.2.1', '2024-09-01T12:00:00Z'),
      ),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()])

    expect(result).toMatchObject({
      updates: [
        {
          trustHolds: [
            {
              reason: 'unreachable-commit',
              sha: MALICIOUS_SHA,
              version: 'v4.2.2',
            },
          ],
          latestVersion: 'v4.2.1',
          targetRef: OLDER_SHA,
          latestSha: OLDER_SHA,
        },
      ],
      blockedByTrust: [],
    })
  })

  describe('with an action exempt from the cool-down', () => {
    it('writes a release whose commit the default branch holds, however recently it got there', async () => {
      routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: MALICIOUS_SHA,
        }),
        ...mainHistoryRoutes({
          [MALICIOUS_SHA]: { atCutoff: ahead(), now: behind() },
        }),
      })

      let result = await plan([makeAction()], {
        minAgeExcludes: [/^actions\//u],
      })

      expect(result).toMatchObject({
        updates: [{ targetRef: MALICIOUS_SHA, effectiveDate: null }],
        blockedByTrust: [],
      })
    })

    it('still holds back a commit no branch of the repository contains', async () => {
      routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: MALICIOUS_SHA,
        }),
        ...walkListing([['v4.2.2', MALICIOUS_SHA]]),
        ...mainHistoryRoutes({ [MALICIOUS_SHA]: undefined }),
        [PROTECTED_BRANCHES_PATH]: ok([]),
      })

      let result = await plan([makeAction()], {
        minAgeExcludes: [/^actions\//u],
      })

      expect(result).toMatchObject({
        blockedByTrust: [{ holdReason: 'unreachable-commit' }],
        updates: [],
      })
    })
  })

  it('measures an immutable release by its release date, with two more requests than the release lookup', async () => {
    let api = routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: RELEASE_SHA,
        immutable: true,
      }),
      ...mainHistoryRoutes({
        [RELEASE_SHA]: { atCutoff: ahead(), now: behind() },
      }),
    })

    let result = await plan([makeAction()])

    expect(result.updates).toMatchObject([
      {
        effectiveDate: new Date(TWO_YEARS_AGO),
        immutableRelease: true,
        targetRef: RELEASE_SHA,
        ageSource: 'release',
      },
    ])
    expect(api.paths).toStrictEqual([
      LATEST_RELEASE_PATH,
      REFERENCE_PATH,
      REPOSITORY,
      comparisonPath(RELEASE_SHA),
    ])
  })

  it.each([
    ['with the cool-down on', {}],
    ['with the cool-down off', { minAge: 0 }],
    [
      'for an action exempt from the cool-down',
      { minAgeExcludes: [/^actions\//u] },
    ],
  ])(
    'holds back a SHA pin whose pinned tag now points at another commit %s, without checking that commit',
    async (_case, options) => {
      let api = routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: MALICIOUS_SHA,
        }),
        ...walkListing([['v4.2.2', MALICIOUS_SHA]]),
      })

      let result = await plan(
        [makeAction({ version: RELEASE_SHA, comment: ' v4.2.2' })],
        options,
      )

      expect(result).toMatchObject({
        blockedByTrust: [
          {
            trustHolds: [
              { reason: 'tag-moved', sha: MALICIOUS_SHA, version: 'v4.2.2' },
            ],
            holdReason: 'tag-moved',
          },
        ],
        updates: [],
      })
      expect(api.paths).not.toContain(REPOSITORY)
    },
  )

  it.each([
    [
      'moved when it has no release',
      notFound(),
      { blockedByTrust: [{ holdReason: 'tag-moved' }], updates: [] },
    ],
    [
      'pinned by hand when its release is immutable',
      ok(makeTagRelease('v4.1.0', TWO_YEARS_AGO, { immutable: true })),
      { updates: [{ targetRef: RELEASE_SHA }], blockedByTrust: [] },
    ],
    [
      'unresolved when its release cannot be read',
      serverError(),
      {
        skipped: [{ skipReason: 'release-unresolved', status: 'skipped' }],
        blockedByTrust: [],
        updates: [],
      },
    ],
  ])(
    'reads the release of a listed tag that no longer points at the pin with the cool-down off, and finds the tag %s',
    async (_case, release, expected) => {
      routeFetch({
        [`${REPOSITORY}/tags?per_page=30`]: ok([
          makeTagListingEntry('v4.1.0', RELEASE_SHA),
          makeTagListingEntry('v4.0.0', OLDER_SHA),
        ]),
        [`${REPOSITORY}/releases/tags/v4.1.0`]: release,
        [REPOSITORY]: ok(makeRepositoryPayload('main')),
        [`${REPOSITORY}/releases?per_page=1`]: ok([]),
        ...walkListing([['v4.1.0', RELEASE_SHA]]),
        [comparisonPath(RELEASE_SHA)]: behind(),
        [LATEST_RELEASE_PATH]: notFound(),
      })

      let result = await plan(
        [makeAction({ version: OLDER_SHA, comment: ' v4.1.0' })],
        { minAge: 0 },
      )

      expect(result).toMatchObject(expected)
    },
  )

  it.each([
    ['an immutable release, whose tag cannot have moved', true, ' v4.2.2'],
    ['a floating tag in the comment, which moves by design', false, ' v4'],
  ])(
    'offers a SHA pin whose comment names %s',
    async (_case, immutable, comment) => {
      routeFetch({
        ...latestReleaseRoutes({
          publishedAt: TWO_YEARS_AGO,
          sha: RELEASE_SHA,
          immutable,
        }),
        ...mainHistoryRoutes({
          [RELEASE_SHA]: { atCutoff: behind(), now: behind() },
        }),
      })

      let result = await plan([makeAction({ version: OLDER_SHA, comment })])

      expect(result).toMatchObject({
        updates: [{ targetRef: RELEASE_SHA }],
        blockedByTrust: [],
      })
    },
  )

  it('finds a commit on a protected branch and dates it by the history of that branch when the default branch cannot be compared', async () => {
    routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      ...mainHistoryRoutes({
        [RELEASE_SHA]: { atCutoff: serverError(), now: serverError() },
      }),
      [branchHistoryPath('releases/v4')]: branchUpdatesPage([
        makeBranchUpdate({
          reference: 'refs/heads/releases/v4',
          timestamp: TIP_SINCE,
          after: RELEASE_SHA,
          before: OLDER_SHA,
        }),
      ]),
      [`${REPOSITORY}/compare/${RELEASE_SHA}...${RELEASE_SHA}`]: ok(
        makeComparisonPayload('identical'),
      ),
      [PROTECTED_BRANCHES_PATH]: ok([
        makeBranchPayload('releases/v4', RELEASE_SHA),
      ]),
    })

    let result = await plan([makeAction()])

    expect(result.updates).toMatchObject([
      {
        effectiveDate: new Date(TIP_SINCE),
        targetRef: RELEASE_SHA,
        ageSource: 'branch',
      },
    ])
  })

  it('holds back a commit outside the history of the repository with a tag style as well', async () => {
    routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: MALICIOUS_SHA,
      }),
      ...walkListing([['v4.2.2', MALICIOUS_SHA]]),
      ...mainHistoryRoutes({ [MALICIOUS_SHA]: undefined }),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()], { style: 'preserve' })

    expect(result).toMatchObject({
      blockedByTrust: [{ holdReason: 'unreachable-commit' }],
      updates: [],
    })
  })

  it('reports a step-down that changes nothing as held back for the tag that failed', async () => {
    routeFetch({
      ...latestReleaseRoutes({
        publishedAt: TWO_YEARS_AGO,
        sha: MALICIOUS_SHA,
      }),
      ...mainHistoryRoutes({
        [OLDER_SHA]: { atCutoff: behind() },
        [MALICIOUS_SHA]: undefined,
      }),
      ...walkListing([
        ['v4.2.2', MALICIOUS_SHA],
        ['v4.2.1', OLDER_SHA],
      ]),
      [`${REPOSITORY}/git/ref/tags/v4`]: ok(
        makeReferencePayload('refs/tags/v4', {
          type: 'commit',
          sha: OLDER_SHA,
        }),
      ),
      [`${REPOSITORY}/releases/tags/v4.2.1`]: ok(
        makeTagRelease('v4.2.1', '2024-09-01T12:00:00Z'),
      ),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction({ version: 'v4' })], {
      style: 'semver',
    })

    expect(result).toMatchObject({
      blockedByTrust: [
        {
          trustHolds: [
            {
              reason: 'unreachable-commit',
              sha: MALICIOUS_SHA,
              version: 'v4.2.2',
            },
          ],
          holdReason: 'unreachable-commit',
          latestSha: MALICIOUS_SHA,
          latestVersion: 'v4.2.2',
        },
      ],
      updates: [],
    })
  })

  it('holds back the newest tag of a tag family when its commit is outside the history of the repository', async () => {
    routeFetch({
      [`${REPOSITORY}/git/matching-refs/tags/actions-`]: ok([
        makeReferencePayload('refs/tags/actions-v1.1.0', {
          sha: MALICIOUS_SHA,
          type: 'commit',
        }),
      ]),
      [`${REPOSITORY}/git/ref/tags/actions-v1.1.0`]: ok(
        makeReferencePayload('refs/tags/actions-v1.1.0', {
          sha: MALICIOUS_SHA,
          type: 'commit',
        }),
      ),
      [`${REPOSITORY}/git/ref/tags/actions-v1.0.0`]: ok(
        makeReferencePayload('refs/tags/actions-v1.0.0', {
          type: 'commit',
          sha: OLDER_SHA,
        }),
      ),
      ...mainHistoryRoutes({ [MALICIOUS_SHA]: undefined }),
      [`${REPOSITORY}/releases/tags/actions-v1.1.0`]: notFound(),
      [REPOSITORY]: ok(makeRepositoryPayload('main')),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction({ version: 'actions-v1.0.0' })])

    expect(result).toMatchObject({
      blockedByTrust: [{ holdReason: 'unreachable-commit' }],
      updates: [],
    })
  })

  it('never dates the newest tag of a family whose name holds `#` by the immutable release of the tag the name starts with', async () => {
    let api = routeFetch({
      [`${REPOSITORY}/git/matching-refs/tags/channel%23`]: ok([
        makeReferencePayload('refs/tags/channel#v1.0.0', {
          type: 'commit',
          sha: OLDER_SHA,
        }),
        makeReferencePayload('refs/tags/channel#v2.0.0', {
          sha: MALICIOUS_SHA,
          type: 'commit',
        }),
      ]),
      [`${REPOSITORY}/git/ref/tags/channel%23v1.0.0`]: ok(
        makeReferencePayload('refs/tags/channel#v1.0.0', {
          type: 'commit',
          sha: OLDER_SHA,
        }),
      ),
      [`${REPOSITORY}/releases/tags/channel`]: ok(
        makeTagRelease('channel', TWO_YEARS_AGO, { immutable: true }),
      ),
      ...mainHistoryRoutes({
        [MALICIOUS_SHA]: { atCutoff: ahead(), now: behind() },
      }),
      [`${REPOSITORY}/releases/tags/channel%23v2.0.0`]: notFound(),
      [REPOSITORY]: ok(makeRepositoryPayload('main')),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction({ version: 'channel#v1.0.0' })])

    expect(result).toMatchObject({
      blockedByAge: [
        {
          latestVersion: 'channel#v2.0.0',
          latestSha: MALICIOUS_SHA,
          holdReason: 'cool-down',
        },
      ],
      updates: [],
    })
    expect(api.paths).not.toContain(`${REPOSITORY}/releases/tags/channel`)
  })

  it('steps past a tag preferred over the latest release when its commit is outside the history of the repository', async () => {
    routeFetch({
      ...latestReleaseRoutes({ publishedAt: TWO_YEARS_AGO, sha: RELEASE_SHA }),
      [`${REPOSITORY}/git/ref/tags/v4.3.0`]: ok(
        makeReferencePayload('refs/tags/v4.3.0', {
          sha: MALICIOUS_SHA,
          type: 'commit',
        }),
      ),
      ...mainHistoryRoutes({
        [RELEASE_SHA]: { atCutoff: behind() },
        [MALICIOUS_SHA]: undefined,
      }),
      [`${REPOSITORY}/tags?per_page=100`]: ok([
        makeTagListingEntry('v4.3.0', MALICIOUS_SHA),
        makeTagListingEntry('v4.2.2', RELEASE_SHA),
      ]),
      [`${REPOSITORY}/releases/tags/v4.2.2`]: ok(
        makeTagRelease('v4.2.2', TWO_YEARS_AGO),
      ),
      [`${REPOSITORY}/releases/tags/v4.3.0`]: notFound(),
      [PROTECTED_BRANCHES_PATH]: ok([]),
    })

    let result = await plan([makeAction()], { preferTags: true })

    expect(result).toMatchObject({
      updates: [
        {
          trustHolds: [
            {
              reason: 'unreachable-commit',
              sha: MALICIOUS_SHA,
              version: 'v4.3.0',
            },
          ],
          latestVersion: 'v4.2.2',
          targetRef: RELEASE_SHA,
        },
      ],
      blockedByTrust: [],
    })
  })
})
