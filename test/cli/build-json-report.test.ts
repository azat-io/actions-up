import { describe, expect, it } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'
import type { ScanResult } from '../../types/scan-result'

import { buildJsonReport } from '../../cli/build-json-report'

describe('buildJsonReport', () => {
  it('serializes update data into a machine-readable report', () => {
    let scanResult: ScanResult = {
      actions: [
        {
          file: '/repo/.github/workflows/ci.yml',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
          line: 12,
        },
        {
          file: '/repo/.github/workflows/release.yml',
          name: 'actions/setup-node',
          type: 'external',
          version: 'main',
          line: 22,
        },
      ],
      workflows: new Map([
        ['0:.github/workflows/release.yml', []],
        ['0:.github/workflows/ci.yml', []],
      ]),
      compositeActions: new Map([['build', '.github/actions/build']]),
    }

    let outdated: ActionUpdate[] = [
      {
        action: {
          file: '/repo/.github/workflows/ci.yml',
          uses: 'actions/checkout@v4',
          ref: 'actions/checkout@v4',
          name: 'actions/checkout',
          type: 'external',
          version: 'v4',
          job: 'build',
          line: 12,
        },
        latestSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        publishedAt: new Date('2024-02-03T04:05:06.000Z'),
        latestVersion: 'v5.0.0',
        currentVersion: 'v4',
        isBreaking: true,
        hasUpdate: true,
      },
    ]

    let skipped: ActionUpdate[] = [
      {
        action: {
          file: '/repo/.github/workflows/release.yml',
          uses: 'actions/setup-node@main',
          name: 'actions/setup-node',
          type: 'external',
          version: 'main',
          line: 22,
        },
        currentVersion: 'main',
        skipReason: 'branch',
        latestVersion: null,
        isBreaking: false,
        publishedAt: null,
        status: 'skipped',
        hasUpdate: false,
        latestSha: null,
      },
    ]

    let blockedByMode: ActionUpdate[] = [
      {
        action: {
          file: '/repo/.github/workflows/deploy.yml',
          uses: 'owner/repo@v1',
          name: 'owner/repo',
          type: 'external',
          version: 'v1',
          line: 8,
        },
        latestSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        latestVersion: 'v2.0.0',
        currentVersion: 'v1',
        publishedAt: null,
        isBreaking: true,
        hasUpdate: true,
      },
    ]

    let report = buildJsonReport({
      directories: ['/repo', '/repo/.github'],
      excludePatterns: ['^local/'],
      status: 'updates-available',
      actionsToCheckCount: 2,
      includeBranches: false,
      recursive: true,
      blockedByMode,
      mode: 'minor',
      cwd: '/repo',
      scanResult,
      minAge: 3,
      outdated,
      skipped,
    })

    expect(report).toEqual({
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
          latestSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          publishedAt: '2024-02-03T04:05:06.000Z',
          latestVersion: 'v5.0.0',
          currentVersion: 'v4',
          isBreaking: true,
          skipReason: null,
          hasUpdate: true,
          status: 'ok',
        },
      ],
      blockedByMode: [
        {
          action: {
            file: '.github/workflows/deploy.yml',
            uses: 'owner/repo@v1',
            name: 'owner/repo',
            type: 'external',
            version: 'v1',
            job: null,
            ref: null,
            line: 8,
          },
          latestSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          latestVersion: 'v2.0.0',
          currentVersion: 'v1',
          publishedAt: null,
          isBreaking: true,
          skipReason: null,
          hasUpdate: true,
          status: 'ok',
        },
      ],
      skipped: [
        {
          action: {
            file: '.github/workflows/release.yml',
            uses: 'actions/setup-node@main',
            name: 'actions/setup-node',
            type: 'external',
            version: 'main',
            job: null,
            ref: null,
            line: 22,
          },
          currentVersion: 'main',
          skipReason: 'branch',
          latestVersion: null,
          isBreaking: false,
          publishedAt: null,
          status: 'skipped',
          hasUpdate: false,
          latestSha: null,
        },
      ],
      summary: {
        totalCompositeActions: 1,
        totalBreakingUpdates: 1,
        totalActionsChecked: 2,
        totalBlockedByMode: 1,
        totalWorkflows: 2,
        totalActions: 2,
        totalSkipped: 1,
        totalUpdates: 1,
      },
      options: {
        directories: ['.', '.github'],
        excludePatterns: ['^local/'],
        includeBranches: false,
        reportOnly: true,
        recursive: true,
        mode: 'minor',
        json: true,
        minAge: 3,
      },
      status: 'updates-available',
      schemaVersion: 1,
    })
  })

  it('keeps absolute paths when files are outside the current working directory', () => {
    let report = buildJsonReport({
      outdated: [
        {
          action: {
            file: '/tmp/shared/workflow.yml',
            name: 'owner/repo',
            type: 'external',
            version: 'v1',
            line: 4,
          },
          latestVersion: 'v1.1.0',
          currentVersion: 'v1',
          isBreaking: false,
          publishedAt: null,
          hasUpdate: true,
          latestSha: null,
        },
      ],
      scanResult: {
        compositeActions: new Map(),
        workflows: new Map(),
        actions: [],
      },
      directories: ['/tmp/shared'],
      status: 'updates-available',
      actionsToCheckCount: 1,
      includeBranches: true,
      excludePatterns: [],
      blockedByMode: [],
      recursive: false,
      mode: 'major',
      cwd: '/repo',
      skipped: [],
      minAge: 0,
    })

    expect(report.options.directories).toEqual(['/tmp/shared'])
    expect(report.updates[0]?.action.file).toBe('/tmp/shared/workflow.yml')
  })

  it('serializes missing optional action fields as null', () => {
    let report = buildJsonReport({
      blockedByMode: [
        {
          action: {
            name: 'owner/repo',
            type: 'external',
            file: '/repo',
          },
          currentVersion: null,
          latestVersion: null,
          isBreaking: false,
          publishedAt: null,
          hasUpdate: false,
          latestSha: null,
        },
      ],
      skipped: [
        {
          action: {
            name: 'actions/cache',
            type: 'external',
          },
          currentVersion: null,
          latestVersion: null,
          isBreaking: false,
          publishedAt: null,
          hasUpdate: false,
          latestSha: null,
        },
      ],
      scanResult: {
        compositeActions: new Map(),
        workflows: new Map(),
        actions: [],
      },
      actionsToCheckCount: 1,
      directories: ['/repo'],
      includeBranches: false,
      status: 'up-to-date',
      excludePatterns: [],
      recursive: false,
      mode: 'major',
      cwd: '/repo',
      outdated: [],
      minAge: 0,
    })

    expect(report.options.directories).toEqual(['.'])
    expect(report.blockedByMode[0]?.action.file).toBe('/repo')
    expect(report.skipped[0]).toEqual({
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
      currentVersion: null,
      latestVersion: null,
      isBreaking: false,
      publishedAt: null,
      hasUpdate: false,
      skipReason: null,
      latestSha: null,
      status: 'ok',
    })
  })

  it('uses process cwd when cwd is not provided', () => {
    let cwd = process.cwd()

    let report = buildJsonReport({
      scanResult: {
        compositeActions: new Map(),
        workflows: new Map(),
        actions: [],
      },
      status: 'no-actions-found',
      actionsToCheckCount: 0,
      includeBranches: false,
      excludePatterns: [],
      directories: [cwd],
      blockedByMode: [],
      recursive: false,
      mode: 'major',
      outdated: [],
      skipped: [],
      minAge: 0,
    })

    expect(report.options.directories).toEqual(['.'])
  })

  it('preserves relative file paths', () => {
    let report = buildJsonReport({
      outdated: [
        {
          action: {
            file: 'relative/workflow.yml',
            name: 'owner/repo',
            type: 'external',
          },
          latestVersion: 'v1.1.0',
          currentVersion: 'v1',
          isBreaking: false,
          publishedAt: null,
          hasUpdate: true,
          latestSha: null,
        },
      ],
      scanResult: {
        compositeActions: new Map(),
        workflows: new Map(),
        actions: [],
      },
      directories: ['/repo/.github'],
      status: 'updates-available',
      actionsToCheckCount: 1,
      includeBranches: false,
      excludePatterns: [],
      blockedByMode: [],
      recursive: false,
      mode: 'major',
      cwd: '/repo',
      skipped: [],
      minAge: 0,
    })

    expect(report.updates[0]?.action.file).toBe('relative/workflow.yml')
    expect(report.options.reportOnly).toBeTruthy()
  })
})
