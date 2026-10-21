import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDocument } from 'yaml'

import type { ActionUpdate } from '../../types/action-update'
import type { GitHubAction } from '../../types/github-action'

import {
  buildJsonErrorReport,
  buildJsonReport,
} from '../../cli/build-json-report'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { scanWorkflowAst } from '../../core/ast/scanners/scan-workflow-ast'
import { makeWorkflowLockfile } from '../helpers/make-workflow-lockfile'

/**
 * Options the CLI passes to the report builder.
 */
type ReportOptions = Parameters<typeof buildJsonReport>[0]

/**
 * Create the report options of a default run in `/repo` that found nothing.
 *
 * @param overrides - Options that differ from the default run.
 * @returns Fresh report options.
 */
function makeReportOptions(
  overrides: Partial<ReportOptions> = {},
): ReportOptions {
  return {
    scanResult: {
      compositeActions: new Map(),
      workflows: new Map(),
      actions: [],
    },
    directories: ['/repo/.github'],
    status: 'updates-available',
    minAgeExcludePatterns: [],
    blockedAsDowngrade: [],
    actionsToCheckCount: 0,
    includeBranches: false,
    excludePatterns: [],
    blockedByTrust: [],
    blockedByMode: [],
    preferTags: false,
    blockedByAge: [],
    recursive: false,
    lockfiles: [],
    mode: 'major',
    outdated: [],
    style: 'sha',
    cwd: '/repo',
    skipped: [],
    minAge: 1,
    ...overrides,
  }
}

/**
 * Create an outdated update as the update check reports it, before a target
 * reference is resolved for it.
 *
 * @param overrides - Fields that differ from a minor update of
 *   `actions/checkout@v4`.
 * @returns Fresh update.
 */
function makeUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    latestSha: '11bd71901bbe5b1630ceea73d27597364c9af683',
    publishedAt: new Date('2024-10-23T14:46:00.000Z'),
    latestVersion: 'v4.2.2',
    currentRefType: 'tag',
    currentVersion: 'v4',
    action: makeAction(),
    isBreaking: false,
    hasUpdate: true,
    status: 'ok',
    ...overrides,
  }
}

/**
 * Create an entry the update check skipped because it is pinned to a branch.
 *
 * @param overrides - Fields that differ from `actions/checkout@main`.
 * @returns Fresh skipped entry.
 */
function makeSkipped(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    action: makeAction({ version: 'main' }),
    currentRefType: 'branch',
    currentVersion: 'main',
    skipReason: 'branch',
    latestVersion: null,
    publishedAt: null,
    status: 'skipped',
    isBreaking: false,
    hasUpdate: false,
    latestSha: null,
    ...overrides,
  }
}

/**
 * Create a runner label update as the CLI builds it from the image catalog.
 *
 * @param overrides - Fields that differ from `ubuntu-22.04` → `ubuntu-24.04`.
 * @returns Fresh runner update.
 */
function makeRunnerUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    currentVersion: 'ubuntu-22.04',
    latestVersion: 'ubuntu-24.04',
    targetRef: 'ubuntu-24.04',
    targetRefStyle: 'tag',
    action: makeRunner(),
    publishedAt: null,
    isBreaking: true,
    latestSha: null,
    hasUpdate: true,
    status: 'ok',
    ...overrides,
  }
}

/**
 * Create an action reference as the scanner reports it. The `uses` and `ref`
 * the scanner derives from the reference are left to the tests that read them.
 *
 * @param overrides - Fields that differ from `actions/checkout@v4` on line 12
 *   of the CI workflow.
 * @returns Fresh action reference.
 */
function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    file: '/repo/.github/workflows/ci.yml',
    name: 'actions/checkout',
    type: 'external',
    version: 'v4',
    job: 'build',
    line: 12,
    ...overrides,
  }
}

/**
 * Create a `runs-on` label as the scanner reports it.
 *
 * @param overrides - Fields that differ from `ubuntu-22.04` on line 4 of the CI
 *   workflow.
 * @returns Fresh runner label.
 */
function makeRunner(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return makeAction({
    version: 'ubuntu-22.04',
    name: 'runner/ubuntu',
    type: 'runner',
    line: 4,
    ...overrides,
  })
}

describe('buildJsonReport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes update data into a machine-readable report', () => {
    let checkout = makeAction({
      uses: 'actions/checkout@v4',
      ref: 'actions/checkout@v4',
    })
    let codeql = makeAction({
      uses: 'github/codeql-action/init@v3.28.0',
      ref: 'github/codeql-action@v3.28.0',
      name: 'github/codeql-action/init',
      version: 'v3.28.0',
      job: 'analyze',
      line: 18,
    })
    let setupPython = makeAction({
      file: '/repo/.github/workflows/release.yml',
      uses: 'actions/setup-python@main',
      ref: 'actions/setup-python@main',
      name: 'actions/setup-python',
      version: 'main',
      job: 'release',
      line: 22,
    })
    let buildPush = makeAction({
      file: '/repo/.github/workflows/release.yml',
      uses: 'docker/build-push-action@v5',
      ref: 'docker/build-push-action@v5',
      name: 'docker/build-push-action',
      job: 'publish',
      version: 'v5',
      line: 30,
    })
    let setupNode = makeAction({
      uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      ref: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      version: '49933ea5288caeca8642d1e84afbd3f7d6820020',
      name: 'actions/setup-node',
      comment: ' v4.4.0',
      line: 15,
    })
    let changedFiles = makeAction({
      uses: 'tj-actions/changed-files@v45.0.0',
      ref: 'tj-actions/changed-files@v45.0.0',
      name: 'tj-actions/changed-files',
      version: 'v45.0.0',
      line: 26,
    })
    let ubuntu = makeRunner()

    let report = buildJsonReport(
      makeReportOptions({
        blockedByTrust: [
          makeUpdate({
            trustHolds: [
              {
                sha: '0e58ed8671d6b60d0890c21b07f8835ace038e67',
                reason: 'unreachable-commit',
                version: 'v45.0.7',
              },
            ],
            latestSha: '0e58ed8671d6b60d0890c21b07f8835ace038e67',
            publishedAt: new Date('2024-09-30T10:00:00.000Z'),
            holdReason: 'unreachable-commit',
            currentVersion: 'v45.0.0',
            latestVersion: 'v45.0.7',
            immutableRelease: false,
            action: changedFiles,
            effectiveDate: null,
            ageSource: null,
          }),
        ],
        outdated: [
          makeUpdate({
            latestSha: '08eba0b27e820071cde6df949e0beb9ba4906955',
            targetRef: '08eba0b27e820071cde6df949e0beb9ba4906955',
            effectiveDate: new Date('2025-08-11T12:00:00.000Z'),
            publishedAt: new Date('2025-08-11T12:00:00.000Z'),
            latestVersion: 'v5.0.0',
            immutableRelease: true,
            targetRefStyle: 'sha',
            ageSource: 'release',
            action: checkout,
            isBreaking: true,
            trustHolds: [],
          }),
          makeRunnerUpdate({ action: ubuntu }),
        ],
        blockedByAge: [
          makeUpdate({
            latestSha: 'b6a472f63d85b9c78a3ac5e89422239fc15e9b3c',
            effectiveDate: new Date('2026-10-02T21:35:33.000Z'),
            publishedAt: new Date('2026-10-02T21:35:33.000Z'),
            currentVersion: 'v3.28.0',
            latestVersion: 'v3.28.1',
            immutableRelease: false,
            holdReason: 'cool-down',
            ageSource: 'release',
            action: codeql,
          }),
        ],
        blockedAsDowngrade: [
          makeUpdate({
            currentVersion: '49933ea5288caeca8642d1e84afbd3f7d6820020',
            latestSha: '39370e3970a6d050c480ffad4ff0ed4d3fdee5af',
            publishedAt: new Date('2025-04-02T10:00:00.000Z'),
            latestVersion: 'v4.3.0',
            holdReason: 'downgrade',
            currentRefType: 'sha',
            action: setupNode,
          }),
        ],
        blockedByMode: [
          makeUpdate({
            latestSha: '263435318d21b8e681c14492fe198d362a7d2c83',
            publishedAt: new Date('2025-05-27T08:00:00.000Z'),
            latestVersion: 'v6.18.0',
            currentVersion: 'v5',
            holdReason: 'mode',
            action: buildPush,
            isBreaking: true,
          }),
        ],
        scanResult: {
          workflows: new Map([
            ['.github/workflows/release.yml', [setupPython, buildPush]],
            ['.github/workflows/ci.yml', [ubuntu, checkout, codeql]],
          ]),
          compositeActions: new Map([['build', '.github/actions/build']]),
          actions: [ubuntu, checkout, codeql, setupPython, buildPush],
        },
        skipped: [makeSkipped({ action: setupPython })],
        directories: ['/repo', '/repo/.github'],
        minAgeExcludePatterns: ['^actions/'],
        excludePatterns: ['^my-org/'],
        status: 'updates-available',
        actionsToCheckCount: 4,
        includeBranches: false,
        preferTags: false,
        style: 'preserve',
        recursive: true,
        mode: 'minor',
        cwd: '/repo',
        minAge: 3,
      }),
    )

    expect(report).toStrictEqual({
      blockedByTrust: [
        {
          action: {
            uses: 'tj-actions/changed-files@v45.0.0',
            ref: 'tj-actions/changed-files@v45.0.0',
            file: '.github/workflows/ci.yml',
            name: 'tj-actions/changed-files',
            version: 'v45.0.0',
            type: 'external',
            job: 'build',
            line: 26,
          },
          trustHolds: [
            {
              sha: '0e58ed8671d6b60d0890c21b07f8835ace038e67',
              reason: 'unreachable-commit',
              version: 'v45.0.7',
            },
          ],
          latestSha: '0e58ed8671d6b60d0890c21b07f8835ace038e67',
          publishedAt: '2024-09-30T10:00:00.000Z',
          holdReason: 'unreachable-commit',
          targetRefRateLimited: false,
          currentVersion: 'v45.0.0',
          latestVersion: 'v45.0.7',
          immutableRelease: false,
          currentRefType: 'tag',
          targetRefStyle: null,
          effectiveDate: null,
          isBreaking: false,
          skipReason: null,
          ageSource: null,
          targetRef: null,
          hasUpdate: true,
          status: 'ok',
        },
      ],
      blockedAsDowngrade: [
        {
          action: {
            uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
            ref: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
            version: '49933ea5288caeca8642d1e84afbd3f7d6820020',
            file: '.github/workflows/ci.yml',
            name: 'actions/setup-node',
            type: 'external',
            job: 'build',
            line: 15,
          },
          currentVersion: '49933ea5288caeca8642d1e84afbd3f7d6820020',
          latestSha: '39370e3970a6d050c480ffad4ff0ed4d3fdee5af',
          publishedAt: '2025-04-02T10:00:00.000Z',
          targetRefRateLimited: false,
          latestVersion: 'v4.3.0',
          holdReason: 'downgrade',
          immutableRelease: null,
          currentRefType: 'sha',
          targetRefStyle: null,
          effectiveDate: null,
          isBreaking: false,
          skipReason: null,
          ageSource: null,
          targetRef: null,
          hasUpdate: true,
          trustHolds: [],
          status: 'ok',
        },
      ],
      blockedByAge: [
        {
          action: {
            uses: 'github/codeql-action/init@v3.28.0',
            ref: 'github/codeql-action@v3.28.0',
            name: 'github/codeql-action/init',
            file: '.github/workflows/ci.yml',
            version: 'v3.28.0',
            type: 'external',
            job: 'analyze',
            line: 18,
          },
          latestSha: 'b6a472f63d85b9c78a3ac5e89422239fc15e9b3c',
          effectiveDate: '2026-10-02T21:35:33.000Z',
          publishedAt: '2026-10-02T21:35:33.000Z',
          targetRefRateLimited: false,
          currentVersion: 'v3.28.0',
          latestVersion: 'v3.28.1',
          immutableRelease: false,
          holdReason: 'cool-down',
          currentRefType: 'tag',
          targetRefStyle: null,
          ageSource: 'release',
          isBreaking: false,
          skipReason: null,
          targetRef: null,
          hasUpdate: true,
          trustHolds: [],
          status: 'ok',
        },
      ],
      updates: [
        {
          action: {
            file: '.github/workflows/ci.yml',
            uses: 'actions/checkout@v4',
            ref: 'actions/checkout@v4',
            name: 'actions/checkout',
            type: 'external',
            version: 'v4',
            job: 'build',
            line: 12,
          },
          latestSha: '08eba0b27e820071cde6df949e0beb9ba4906955',
          targetRef: '08eba0b27e820071cde6df949e0beb9ba4906955',
          effectiveDate: '2025-08-11T12:00:00.000Z',
          publishedAt: '2025-08-11T12:00:00.000Z',
          targetRefRateLimited: false,
          latestVersion: 'v5.0.0',
          immutableRelease: true,
          currentRefType: 'tag',
          targetRefStyle: 'sha',
          currentVersion: 'v4',
          ageSource: 'release',
          holdReason: null,
          skipReason: null,
          isBreaking: true,
          hasUpdate: true,
          trustHolds: [],
          status: 'ok',
        },
      ],
      blockedByMode: [
        {
          action: {
            file: '.github/workflows/release.yml',
            uses: 'docker/build-push-action@v5',
            ref: 'docker/build-push-action@v5',
            name: 'docker/build-push-action',
            type: 'external',
            job: 'publish',
            version: 'v5',
            line: 30,
          },
          latestSha: '263435318d21b8e681c14492fe198d362a7d2c83',
          publishedAt: '2025-05-27T08:00:00.000Z',
          targetRefRateLimited: false,
          latestVersion: 'v6.18.0',
          immutableRelease: null,
          currentRefType: 'tag',
          targetRefStyle: null,
          currentVersion: 'v5',
          effectiveDate: null,
          holdReason: 'mode',
          skipReason: null,
          isBreaking: true,
          ageSource: null,
          targetRef: null,
          hasUpdate: true,
          trustHolds: [],
          status: 'ok',
        },
      ],
      skipped: [
        {
          action: {
            file: '.github/workflows/release.yml',
            uses: 'actions/setup-python@main',
            ref: 'actions/setup-python@main',
            name: 'actions/setup-python',
            type: 'external',
            version: 'main',
            job: 'release',
            line: 22,
          },
          targetRefRateLimited: false,
          currentRefType: 'branch',
          immutableRelease: null,
          currentVersion: 'main',
          skipReason: 'branch',
          targetRefStyle: null,
          effectiveDate: null,
          latestVersion: null,
          isBreaking: false,
          publishedAt: null,
          status: 'skipped',
          holdReason: null,
          hasUpdate: false,
          ageSource: null,
          latestSha: null,
          targetRef: null,
          trustHolds: [],
        },
      ],
      runners: [
        {
          action: {
            file: '.github/workflows/ci.yml',
            version: 'ubuntu-22.04',
            name: 'runner/ubuntu',
            type: 'runner',
            job: 'build',
            uses: null,
            ref: null,
            line: 4,
          },
          currentVersion: 'ubuntu-22.04',
          latestVersion: 'ubuntu-24.04',
          targetRefRateLimited: false,
          targetRef: 'ubuntu-24.04',
          immutableRelease: null,
          targetRefStyle: 'tag',
          currentRefType: null,
          effectiveDate: null,
          publishedAt: null,
          skipReason: null,
          holdReason: null,
          isBreaking: true,
          ageSource: null,
          latestSha: null,
          hasUpdate: true,
          trustHolds: [],
          status: 'ok',
        },
      ],
      summary: {
        totalBlockedAsDowngrade: 1,
        totalCompositeActions: 1,
        totalBreakingUpdates: 1,
        totalActionsChecked: 4,
        totalBlockedByTrust: 1,
        totalRunnerUpdates: 1,
        totalBlockedByMode: 1,
        totalBlockedByAge: 1,
        totalTrustHolds: 1,
        totalWorkflows: 2,
        totalActions: 4,
        totalRunners: 1,
        totalSkipped: 1,
        totalUpdates: 1,
      },
      options: {
        minAgeExcludePatterns: ['^actions/'],
        excludePatterns: ['^my-org/'],
        directories: ['.', '.github'],
        includeBranches: false,
        preferTags: false,
        style: 'preserve',
        reportOnly: true,
        recursive: true,
        mode: 'minor',
        json: true,
        minAge: 3,
      },
      status: 'updates-available',
      schemaVersion: 2,
      lockfiles: [],
    })
  })

  it('describes the workflow lockfiles found, with paths relative to the working directory when they are inside it', () => {
    let report = buildJsonReport(
      makeReportOptions({
        lockfiles: [
          makeWorkflowLockfile({
            workflows: new Set([
              '/repo/.github/workflows/release.yml',
              '/repo/.github/workflows/ci.yml',
            ]),
          }),
          makeWorkflowLockfile({
            workflows: new Set(['/other/.github/workflows/ci.yml']),
            path: '/other/.github/workflows/actions.lock',
            error: 'unsupported schema version v0.0.4',
            version: 'v0.0.4',
            root: '/other',
          }),
          makeWorkflowLockfile({
            path: '/locked/.github/workflows/actions.lock',
            error: 'unreadable file',
            root: '/locked',
            workflows: null,
            version: null,
          }),
        ],
      }),
    )

    expect(report.lockfiles).toStrictEqual([
      {
        onboardedWorkflows: [
          '.github/workflows/ci.yml',
          '.github/workflows/release.yml',
        ],
        path: '.github/workflows/actions.lock',
        version: 'v0.0.3',
        error: null,
      },
      {
        onboardedWorkflows: ['/other/.github/workflows/ci.yml'],
        path: '/other/.github/workflows/actions.lock',
        error: 'unsupported schema version v0.0.4',
        version: 'v0.0.4',
      },
      {
        path: '/locked/.github/workflows/actions.lock',
        error: 'unreadable file',
        onboardedWorkflows: null,
        version: null,
      },
    ])
  })

  it('reports the uses value and repository ref of scanned references', () => {
    let content = [
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-22.04',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: github/codeql-action/init@v3',
      '  call:',
      '    uses: owner/repo/.github/workflows/ci.yml@v1',
      '',
    ].join('\n')
    let scanned = scanWorkflowAst(
      parseDocument(content),
      content,
      '/repo/.github/workflows/ci.yml',
    )

    let report = buildJsonReport(
      makeReportOptions({
        outdated: scanned.map(action => makeUpdate({ action })),
      }),
    )

    expect(
      report.updates.map(({ action }) => [action.uses, action.ref]),
    ).toStrictEqual([
      ['actions/checkout@v4', 'actions/checkout@v4'],
      ['github/codeql-action/init@v3', 'github/codeql-action@v3'],
      ['owner/repo/.github/workflows/ci.yml@v1', 'owner/repo@v1'],
    ])
    expect(
      report.runners.map(({ action }) => [action.uses, action.ref]),
    ).toStrictEqual([[null, null]])
  })

  it('reports runner updates apart from action updates', () => {
    let report = buildJsonReport(
      makeReportOptions({ outdated: [makeRunnerUpdate(), makeUpdate()] }),
    )

    expect(report).toMatchObject({
      updates: [{ action: { name: 'actions/checkout', type: 'external' } }],
      runners: [{ action: { name: 'runner/ubuntu', type: 'runner' } }],
    })
  })

  it('counts runners apart from actions in the summary', () => {
    let checkout = makeAction()
    let setupNode = makeAction({ name: 'actions/setup-node', line: 15 })
    let cache = makeAction({ name: 'actions/cache', line: 18 })
    let uploadArtifact = makeAction({
      name: 'actions/upload-artifact',
      line: 21,
    })
    let ubuntu = makeRunner()
    let macos = makeRunner({
      name: 'runner/macos',
      version: 'macos-14',
      job: 'test',
      line: 30,
    })

    let report = buildJsonReport(
      makeReportOptions({
        scanResult: {
          workflows: new Map([
            [
              '.github/workflows/ci.yml',
              [ubuntu, checkout, setupNode, cache, macos, uploadArtifact],
            ],
          ]),
          actions: [ubuntu, checkout, setupNode, cache, macos, uploadArtifact],
          compositeActions: new Map(),
        },
        outdated: [
          makeUpdate({ action: checkout }),
          makeRunnerUpdate({ action: ubuntu }),
          makeUpdate({ action: setupNode }),
          makeUpdate({ action: cache }),
        ],
      }),
    )

    expect(report.summary).toMatchObject({
      totalBreakingUpdates: 0,
      totalRunnerUpdates: 1,
      totalRunners: 2,
      totalUpdates: 3,
      totalActions: 4,
    })
  })

  it('counts only breaking updates as breaking', () => {
    let report = buildJsonReport(
      makeReportOptions({
        outdated: [
          makeUpdate({ latestVersion: 'v5.0.0', isBreaking: true }),
          makeUpdate({
            action: makeAction({ name: 'actions/setup-node', line: 15 }),
          }),
          makeUpdate({
            action: makeAction({ name: 'actions/cache', line: 18 }),
          }),
        ],
      }),
    )

    expect(report.summary.totalBreakingUpdates).toBe(1)
  })

  it('counts updates blocked by mode, held back by age and skipped separately', () => {
    let report = buildJsonReport(
      makeReportOptions({
        skipped: [
          makeSkipped(),
          makeSkipped({
            action: makeAction({
              name: 'actions/setup-go',
              version: 'main',
              line: 24,
            }),
          }),
          makeSkipped({
            action: makeAction({
              name: 'actions/upload-artifact',
              version: 'main',
              line: 27,
            }),
          }),
        ],
        blockedByAge: [
          makeUpdate({
            action: makeAction({ name: 'actions/setup-node', line: 15 }),
          }),
          makeUpdate({
            action: makeAction({ name: 'actions/cache', line: 18 }),
          }),
        ],
        blockedByMode: [
          makeUpdate({ latestVersion: 'v5.0.0', isBreaking: true }),
        ],
      }),
    )

    expect(report.summary).toMatchObject({
      totalBlockedByMode: 1,
      totalBlockedByAge: 2,
      totalSkipped: 3,
    })
  })

  it('counts scanned workflows and composite actions apart from actions', () => {
    let checkout = makeAction()
    let setupNode = makeAction({
      file: '/repo/.github/workflows/release.yml',
      name: 'actions/setup-node',
      line: 9,
    })
    let cache = makeAction({
      file: '/repo/.github/actions/build/action.yml',
      name: 'actions/cache',
      line: 7,
    })

    let report = buildJsonReport(
      makeReportOptions({
        scanResult: {
          workflows: new Map([
            ['.github/workflows/release.yml', [setupNode]],
            ['.github/workflows/ci.yml', [checkout]],
          ]),
          compositeActions: new Map([['build', '.github/actions/build']]),
          actions: [checkout, setupNode, cache],
        },
      }),
    )

    expect(report.summary).toMatchObject({
      totalCompositeActions: 1,
      totalWorkflows: 2,
      totalActions: 3,
    })
  })

  it('echoes the settings of the run', () => {
    let report = buildJsonReport(
      makeReportOptions({
        excludePatterns: ['^local/', '^runner/'],
        minAgeExcludePatterns: ['^my-org/'],
        includeBranches: true,
        status: 'up-to-date',
        preferTags: true,
        recursive: false,
        style: 'semver',
        mode: 'patch',
        minAge: 0,
      }),
    )

    expect(report).toMatchObject({
      options: {
        excludePatterns: ['^local/', '^runner/'],
        minAgeExcludePatterns: ['^my-org/'],
        includeBranches: true,
        preferTags: true,
        recursive: false,
        style: 'semver',
        mode: 'patch',
        minAge: 0,
      },
      status: 'up-to-date',
    })
  })

  it('relativizes paths against the process working directory when no cwd is given', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/repo')

    let report = buildJsonReport(
      makeReportOptions({
        directories: ['/repo/.github'],
        outdated: [makeUpdate()],
        cwd: undefined,
      }),
    )

    expect(report).toMatchObject({
      updates: [{ action: { file: '.github/workflows/ci.yml' } }],
      options: { directories: ['.github'] },
    })
  })

  it('keeps absolute paths of files outside the working directory', () => {
    let report = buildJsonReport(
      makeReportOptions({
        outdated: [
          makeUpdate({
            action: makeAction({ file: '/tmp/shared/workflow.yml' }),
          }),
        ],
        cwd: '/repo',
      }),
    )

    expect(report.updates).toMatchObject([
      { action: { file: '/tmp/shared/workflow.yml' } },
    ])
  })

  it('keeps absolute paths of scan directories outside the working directory', () => {
    let report = buildJsonReport(
      makeReportOptions({ directories: ['/tmp/shared'], cwd: '/repo' }),
    )

    expect(report.options.directories).toStrictEqual(['/tmp/shared'])
  })

  it('preserves relative file paths as written', () => {
    /**
     * `path.relative` resolves a relative path against `process.cwd()`, so the
     * process directory is pinned to the report one: a path rewritten relative
     * to it would come out without its leading `./`.
     */
    vi.spyOn(process, 'cwd').mockReturnValue('/repo')

    let report = buildJsonReport(
      makeReportOptions({
        outdated: [
          makeUpdate({
            action: makeAction({ file: './.github/workflows/ci.yml' }),
          }),
        ],
        cwd: '/repo',
      }),
    )

    expect(report.updates).toMatchObject([
      { action: { file: './.github/workflows/ci.yml' } },
    ])
  })

  it('serializes missing optional fields as null', () => {
    let report = buildJsonReport(
      makeReportOptions({
        skipped: [
          {
            action: { name: 'actions/cache', type: 'external' },
            currentVersion: null,
            latestVersion: null,
            publishedAt: null,
            status: 'skipped',
            isBreaking: false,
            hasUpdate: false,
            latestSha: null,
          },
        ],
      }),
    )

    expect(report.skipped).toStrictEqual([
      {
        action: {
          name: 'actions/cache',
          type: 'external',
          version: null,
          file: null,
          line: null,
          uses: null,
          job: null,
          ref: null,
        },
        targetRefRateLimited: false,
        immutableRelease: null,
        currentRefType: null,
        targetRefStyle: null,
        currentVersion: null,
        latestVersion: null,
        effectiveDate: null,
        publishedAt: null,
        status: 'skipped',
        isBreaking: false,
        skipReason: null,
        holdReason: null,
        hasUpdate: false,
        ageSource: null,
        latestSha: null,
        targetRef: null,
        trustHolds: [],
      },
    ])
  })

  it('flags a target that fell back to the exact version because tag validation was rate limited', () => {
    let report = buildJsonReport(
      makeReportOptions({
        outdated: [
          makeUpdate({
            targetRefRateLimited: true,
            targetRefStyle: 'tag',
            targetRef: 'v4.2.2',
          }),
        ],
      }),
    )

    expect(report.updates).toMatchObject([
      { targetRefRateLimited: true, targetRef: 'v4.2.2' },
    ])
  })

  it('counts updates held back as downgrades apart from the other held-back updates', () => {
    let report = buildJsonReport(
      makeReportOptions({
        blockedAsDowngrade: [
          makeUpdate({ action: makeAction({ name: 'actions/setup-node' }) }),
          makeUpdate({ action: makeAction({ name: 'actions/cache' }) }),
        ],
      }),
    )

    expect(report.summary).toMatchObject({
      totalBlockedAsDowngrade: 2,
      totalBlockedByMode: 0,
      totalBlockedByAge: 0,
      totalUpdates: 0,
    })
    expect(report.blockedAsDowngrade).toMatchObject([
      { action: { name: 'actions/setup-node' } },
      { action: { name: 'actions/cache' } },
    ])
  })

  describe('current behavior pending owner decision', () => {
    it('keeps a file path equal to the working directory absolute', () => {
      let report = buildJsonReport(
        makeReportOptions({
          blockedByMode: [
            makeUpdate({ action: makeAction({ file: '/repo' }) }),
          ],
          cwd: '/repo',
        }),
      )

      expect(report.blockedByMode).toMatchObject([
        { action: { file: '/repo' } },
      ])
    })

    it('reports a skipped entry without a status as ok', () => {
      let report = buildJsonReport(
        makeReportOptions({ skipped: [makeSkipped({ status: undefined })] }),
      )

      expect(report.skipped).toMatchObject([
        { skipReason: 'branch', status: 'ok' },
      ])
    })
  })
})

describe('buildJsonErrorReport', () => {
  it('reports a rate limit together with its message', () => {
    let error = new GitHubRateLimitError(new Date('2026-10-03T15:00:00.000Z'))

    let report = buildJsonErrorReport(error)

    expect(report).toStrictEqual({
      error: { message: error.message, rateLimited: true },
      schemaVersion: 2,
      status: 'error',
    })
  })

  it('reports any other failure with its message', () => {
    let report = buildJsonErrorReport(
      new SyntaxError('Invalid regular expression: /[/: Unterminated class'),
    )

    expect(report).toStrictEqual({
      error: {
        message: 'Invalid regular expression: /[/: Unterminated class',
        rateLimited: false,
      },
      schemaVersion: 2,
      status: 'error',
    })
  })

  it('reports a thrown value that is not an error as text', () => {
    let report = buildJsonErrorReport('scan aborted')

    expect(report).toStrictEqual({
      error: { message: 'scan aborted', rateLimited: false },
      schemaVersion: 2,
      status: 'error',
    })
  })
})
