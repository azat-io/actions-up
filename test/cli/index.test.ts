import type { Spinner } from 'nanospinner'
import type { MockInstance } from 'vitest'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'
import type { GitHubClient } from '../../types/github-client'
import type { ScanResult } from '../../types/scan-result'

import { promptUpdateSelection } from '../../core/interactive/prompt-update-selection'
import { resolveTargetReference } from '../../core/updates/resolve-target-reference'
import { printRateLimitWarning } from '../../cli/print-rate-limit-warning'
import { getCompatibleUpdate } from '../../core/api/get-compatible-update'
import { printDowngradeWarning } from '../../cli/print-downgrade-warning'
import { createGitHubClient } from '../../core/api/create-github-client'
import { printSkippedWarning } from '../../cli/print-skipped-warning'
import { printMinAgeWarning } from '../../cli/print-min-age-warning'
import { applyUpdates } from '../../core/ast/update/apply-updates'
import { printModeWarning } from '../../cli/print-mode-warning'
import { shouldIgnore } from '../../core/ignore/should-ignore'
import { findRepoRoot } from '../../core/fs/find-repo-root'
import { checkUpdates } from '../../core/api/check-updates'
import { scanRecursive } from '../../core/scan-recursive'
import { scanGitHubActions } from '../../core/index'
import { run } from '../../cli/index'

let { createSpinnerMock, spinnerMock } = vi.hoisted(() => {
  let spinner: Spinner = {
    isSpinning: vi.fn(() => false),
    success: vi.fn(() => spinner),
    render: vi.fn(() => spinner),
    update: vi.fn(() => spinner),
    write: vi.fn(() => spinner),
    reset: vi.fn(() => spinner),
    clear: vi.fn(() => spinner),
    error: vi.fn(() => spinner),
    start: vi.fn(() => spinner),
    info: vi.fn(() => spinner),
    loop: vi.fn(() => spinner),
    spin: vi.fn(() => spinner),
    stop: vi.fn(() => spinner),
    warn: vi.fn(() => spinner),
  }
  return { createSpinnerMock: vi.fn(() => spinner), spinnerMock: spinner }
})

vi.mock(import('nanospinner'), () => ({ createSpinner: createSpinnerMock }))
vi.mock(import('../../cli/print-rate-limit-warning'))
vi.mock(import('../../cli/print-downgrade-warning'))
vi.mock(import('../../cli/print-skipped-warning'))
vi.mock(import('../../cli/print-min-age-warning'))
vi.mock(import('../../cli/print-mode-warning'))
vi.mock(import('../../core/interactive/prompt-update-selection'))
vi.mock(import('../../core/updates/resolve-target-reference'))
vi.mock(import('../../core/api/get-compatible-update'))
vi.mock(import('../../core/api/create-github-client'))
vi.mock(import('../../core/ast/update/apply-updates'))
vi.mock(import('../../core/ignore/should-ignore'))
vi.mock(import('../../core/fs/find-repo-root'))
vi.mock(import('../../core/api/check-updates'))
vi.mock(import('../../core/scan-recursive'))
vi.mock(import('../../core/index'))

describe('run', () => {
  let originalEnvironment: NodeJS.ProcessEnv
  let originalArgv: string[]

  let consoleInfoSpy: MockInstance
  let consoleErrorSpy: MockInstance
  let stdoutWriteSpy: MockInstance
  let processExitSpy: MockInstance
  let cwdSpy: MockInstance

  function createScanResult(actions: ScanResult['actions']): ScanResult {
    return {
      workflows: new Map([['.github/workflows/ci.yml', actions]]),
      compositeActions: new Map<string, string>(),
      actions,
    }
  }

  function createUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
    return {
      action: {
        file: '/repo/.github/workflows/ci.yml',
        uses: 'actions/checkout@v3',
        name: 'actions/checkout',
        type: 'external',
        version: 'v3',
        line: 5,
      },
      latestSha: 'a'.repeat(40),
      currentVersion: 'v3',
      latestVersion: 'v4',
      publishedAt: null,
      isBreaking: true,
      hasUpdate: true,
      status: 'ok',
      ...overrides,
    }
  }

  beforeEach(() => {
    originalEnvironment = { ...process.env }
    originalArgv = process.argv

    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo')

    vi.mocked(findRepoRoot).mockResolvedValue('/repo')
    vi.mocked(shouldIgnore).mockResolvedValue(false)
    vi.mocked(createGitHubClient).mockReturnValue({} as GitHubClient)
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([]))
    vi.mocked(scanRecursive).mockResolvedValue(createScanResult([]))
    vi.mocked(checkUpdates).mockResolvedValue([])
    vi.mocked(applyUpdates).mockResolvedValue()
  })

  afterEach(() => {
    process.env = originalEnvironment
    process.argv = originalArgv
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('applies updates automatically with --yes', async () => {
    process.env['GITHUB_TOKEN'] = 'token'
    process.argv = ['node', 'actions-up', '--yes']

    let action = {
      file: '/repo/.github/workflows/ci.yml',
      uses: 'actions/checkout@v3',
      type: 'external' as const,
      name: 'actions/checkout',
      version: 'v3',
      line: 5,
    }
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate({ action })])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({
        targetRefRateLimited: false,
        targetRef: 'a'.repeat(40),
        targetRefStyle: 'sha',
        action,
      }),
    )

    run()

    await vi.waitFor(() => {
      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ targetRef: 'a'.repeat(40) }),
      ])
    })

    expect(checkUpdates).toHaveBeenCalledWith([action], 'token', {
      includeBranches: false,
      preferTags: false,
      style: 'sha',
      client: {},
    })
    expect(spinnerMock.success).toHaveBeenCalledWith(
      expect.stringContaining('updates available'),
    )
    expect(createSpinnerMock).toHaveBeenCalledWith('Checking for updates...')
    expect(promptUpdateSelection).not.toHaveBeenCalled()
    expect(getCompatibleUpdate).not.toHaveBeenCalled()
    expect(processExitSpy).not.toHaveBeenCalled()
    expect(cwdSpy).toHaveBeenCalledWith()
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Actions Up!'),
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(stdoutWriteSpy).not.toHaveBeenCalled()
  })

  it('prints help without running the pipeline', () => {
    process.argv = ['node', 'actions-up', '--help']

    run()

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
    )
    expect(scanGitHubActions).not.toHaveBeenCalled()
  })

  it('exits on argument errors', () => {
    process.argv = ['node', 'actions-up', '--min-age', 'nope']
    processExitSpy.mockImplementation(() => {
      throw new Error('process.exit called')
    })

    expect(() => {
      run()
    }).toThrow('process.exit called')

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error:'),
      expect.stringContaining('--min-age'),
    )
    expect(scanGitHubActions).not.toHaveBeenCalled()
  })

  it('writes a JSON report to stdout', async () => {
    process.argv = ['node', 'actions-up', '--json']

    run()

    await vi.waitFor(() => {
      expect(stdoutWriteSpy).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining('"status"'),
      )
    })

    let payload = JSON.parse(String(stdoutWriteSpy.mock.calls[0]![0])) as {
      status: string
    }
    expect(payload.status).toBe('no-actions-found')
    expect(createSpinnerMock).not.toHaveBeenCalled()
  })

  it('reports pipeline failures and exits', async () => {
    process.argv = ['node', 'actions-up']
    vi.mocked(scanGitHubActions).mockRejectedValue(new Error('boom'))

    run()

    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    expect(spinnerMock.error).toHaveBeenCalledWith('Failed')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error:'),
      'boom',
    )
  })

  it('scans recursively without resolving a repository root', async () => {
    process.argv = ['node', 'actions-up', '--recursive', '--json']

    run()

    await vi.waitFor(() => {
      expect(stdoutWriteSpy.mock.calls).toHaveLength(1)
    })

    expect(vi.mocked(scanRecursive).mock.calls).toHaveLength(1)
    expect(scanGitHubActions).not.toHaveBeenCalled()
    expect(findRepoRoot).not.toHaveBeenCalled()
  })

  it('reports when no actions are found outside JSON mode', async () => {
    process.argv = ['node', 'actions-up']

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('No GitHub Actions found'),
      )
    })
  })

  it('drops actions matching a comma-separated exclude', async () => {
    process.argv = [
      'node',
      'actions-up',
      '--exclude',
      'actions/checkout, actions/cache',
    ]
    vi.mocked(scanGitHubActions).mockResolvedValue(
      createScanResult([createUpdate().action]),
    )

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('Nothing to check after excludes'),
      )
    })

    expect(checkUpdates).not.toHaveBeenCalled()
  })

  it('reports nothing to check after excludes in JSON mode', async () => {
    process.argv = [
      'node',
      'actions-up',
      '--json',
      '--exclude',
      'actions/checkout',
      '--exclude',
      'actions/cache',
    ]
    vi.mocked(scanGitHubActions).mockResolvedValue(
      createScanResult([createUpdate().action]),
    )

    run()

    await vi.waitFor(() => {
      expect(stdoutWriteSpy.mock.calls).toHaveLength(1)
    })

    let payload = JSON.parse(String(stdoutWriteSpy.mock.calls[0]![0])) as {
      status: string
    }
    expect(payload.status).toBe('nothing-to-check')
  })

  it('keeps actions that no exclude pattern matches', async () => {
    process.argv = ['node', 'actions-up', '--exclude', 'other/action', '--yes']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate()])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRef: 'b'.repeat(40), targetRefStyle: 'sha' }),
    )

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(applyUpdates).mock.calls).toHaveLength(1)
    })

    expect(checkUpdates).toHaveBeenCalledWith(
      [action],
      undefined,
      expect.objectContaining({ style: 'sha' }),
    )
  })

  it('drops updates hidden by ignore comments', async () => {
    process.argv = ['node', 'actions-up']
    vi.mocked(scanGitHubActions).mockResolvedValue(
      createScanResult([createUpdate().action]),
    )
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate()])
    vi.mocked(shouldIgnore).mockResolvedValue(true)

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('already at the latest version'),
      )
    })

    expect(resolveTargetReference).not.toHaveBeenCalled()
  })

  it('prints every warning when nothing survives the filters', async () => {
    process.argv = ['node', 'actions-up', '--mode', 'minor']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        skipReason: 'branch',
        status: 'skipped',
        hasUpdate: false,
      }),
      createUpdate({
        action: { ...action, comment: ' v9.0.0' },
        currentVersion: 'c'.repeat(40),
        latestVersion: 'v4.0.0',
      }),
      createUpdate({
        currentVersion: 'v3.0.0',
        publishedAt: new Date(),
        latestVersion: 'v3.1.0',
      }),
      createUpdate({
        publishedAt: new Date('2020-01-01T00:00:00Z'),
        currentVersion: 'v3.0.0',
        latestVersion: 'v4.0.0',
      }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      reason: 'no-candidate',
      update: null,
    })

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('already at the latest version'),
      )
    })

    expect(vi.mocked(printSkippedWarning).mock.calls).toHaveLength(1)
    expect(vi.mocked(printDowngradeWarning).mock.calls).toHaveLength(1)
    expect(vi.mocked(printMinAgeWarning).mock.calls).toHaveLength(1)
    expect(vi.mocked(printModeWarning).mock.calls).toHaveLength(1)
  })

  it('suppresses warnings with --quiet', async () => {
    process.argv = ['node', 'actions-up', '--quiet']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        skipReason: 'branch',
        status: 'skipped',
        hasUpdate: false,
      }),
      createUpdate({ publishedAt: new Date() }),
    ])

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('already at the latest version'),
      )
    })

    expect(printSkippedWarning).not.toHaveBeenCalled()
    expect(printMinAgeWarning).not.toHaveBeenCalled()
  })

  it('reports an up-to-date repository in JSON mode', async () => {
    process.argv = ['node', 'actions-up', '--json']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({ hasUpdate: false, status: 'ok' }),
    ])

    run()

    await vi.waitFor(() => {
      expect(stdoutWriteSpy.mock.calls).toHaveLength(1)
    })

    let payload = JSON.parse(String(stdoutWriteSpy.mock.calls[0]![0])) as {
      status: string
    }
    expect(payload.status).toBe('up-to-date')
  })

  it('skips updates whose style cannot be resolved', async () => {
    process.argv = ['node', 'actions-up']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate()])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRefStyle: null, targetRef: null }),
    )

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(printSkippedWarning).mock.calls).toHaveLength(1)
    })

    expect(applyUpdates).not.toHaveBeenCalled()
  })

  it('resolves repeated occurrences of one reference only once', async () => {
    process.argv = ['node', 'actions-up', '--dry-run']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate(), createUpdate()])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRef: 'b'.repeat(40), targetRefStyle: 'sha' }),
    )

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 actions would be updated'),
      )
    })

    expect(vi.mocked(resolveTargetReference).mock.calls).toHaveLength(1)
  })

  it('recovers a mode-blocked update through a compatible tag', async () => {
    process.argv = ['node', 'actions-up', '--mode', 'patch', '--dry-run']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({ currentVersion: 'v3.0.0', latestVersion: 'v4.0.0' }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      update: { sha: 'd'.repeat(40), version: 'v3.0.1', publishedAt: null },
      reason: null,
    })
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRefStyle: 'tag', targetRef: 'v3.0.1' }),
    )

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 actions would be updated'),
      )
    })

    expect(vi.mocked(getCompatibleUpdate).mock.calls).toHaveLength(1)
    expect(printModeWarning).not.toHaveBeenCalled()
  })

  it('steps down to an older release when the cool-down holds the latest', async () => {
    process.argv = ['node', 'actions-up', '--min-age', '7', '--dry-run']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        currentVersion: 'v0.6.0',
        publishedAt: new Date(),
        latestVersion: 'v0.6.3',
        isBreaking: false,
      }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      update: {
        publishedAt: new Date('2026-08-01T00:00:00.000Z'),
        sha: 'd'.repeat(40),
        version: 'v0.6.2',
      },
      reason: null,
    })
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRefStyle: 'tag', targetRef: 'v0.6.2' }),
    )

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 actions would be updated'),
      )
    })

    expect(getCompatibleUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        minAgeMs: 7 * 24 * 60 * 60 * 1000,
        currentVersion: 'v0.6.0',
        mode: 'major',
      }),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('v0.6.2'),
    )
    expect(printMinAgeWarning).not.toHaveBeenCalled()
  })

  it('reports the cool-down when no release clears it', async () => {
    process.argv = ['node', 'actions-up', '--min-age', '7']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        currentVersion: 'v0.6.0',
        publishedAt: new Date(),
        latestVersion: 'v0.6.3',
        isBreaking: false,
      }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      reason: 'cool-down',
      update: null,
    })

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(printMinAgeWarning).mock.calls).toHaveLength(1)
    })

    expect(printModeWarning).not.toHaveBeenCalled()
    expect(resolveTargetReference).not.toHaveBeenCalled()
  })

  it('blames the cool-down when the mode still had a candidate', async () => {
    process.argv = ['node', 'actions-up', '--mode', 'minor', '--min-age', '7']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        publishedAt: new Date('2020-01-01T00:00:00.000Z'),
        currentVersion: 'v3.0.0',
        latestVersion: 'v4.0.0',
      }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      reason: 'cool-down',
      update: null,
    })

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(printMinAgeWarning).mock.calls).toHaveLength(1)
    })

    expect(printModeWarning).not.toHaveBeenCalled()
  })

  it('reads the pinned version from a comment when applying the mode filter', async () => {
    process.argv = ['node', 'actions-up', '--mode', 'minor', '--dry-run']
    let action = { ...createUpdate().action, comment: ' v3.0.0' }
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        currentVersion: 'e'.repeat(40),
        latestVersion: 'v3.1.0',
        action,
      }),
    ])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRefStyle: 'tag', targetRef: 'v3.1.0', action }),
    )

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('1 actions would be updated'),
      )
    })

    expect(getCompatibleUpdate).not.toHaveBeenCalled()
  })

  it('warns about rate limited fallbacks and prints a tag dry run', async () => {
    process.argv = ['node', 'actions-up', '--dry-run']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate()])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({
        targetRefRateLimited: true,
        targetRefStyle: 'tag',
        targetRef: 'v4',
      }),
    )

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(printRateLimitWarning).mock.calls).toHaveLength(1)
    })

    expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('v4'))
  })

  it('reports available updates in JSON mode', async () => {
    process.argv = ['node', 'actions-up', '--json']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({ isBreaking: false }),
    ])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRef: 'b'.repeat(40), targetRefStyle: 'sha' }),
    )

    run()

    await vi.waitFor(() => {
      expect(stdoutWriteSpy.mock.calls).toHaveLength(1)
    })

    let payload = JSON.parse(String(stdoutWriteSpy.mock.calls[0]![0])) as {
      status: string
    }
    expect(payload.status).toBe('updates-available')
  })

  it('applies the interactive selection', async () => {
    process.argv = ['node', 'actions-up']
    let { action } = createUpdate()
    let resolved = createUpdate({
      targetRef: 'b'.repeat(40),
      targetRefStyle: 'sha',
    })
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([createUpdate()])
    vi.mocked(resolveTargetReference).mockResolvedValue(resolved)
    vi.mocked(promptUpdateSelection).mockResolvedValue([resolved])

    run()

    await vi.waitFor(() => {
      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([resolved])
    })

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('Updates applied successfully'),
    )
  })

  it('does nothing when the interactive selection is empty', async () => {
    process.argv = ['node', 'actions-up']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(
      createScanResult([action, { ...action, line: 9 }]),
    )
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        skipReason: 'branch',
        status: 'skipped',
        hasUpdate: false,
      }),
      createUpdate(),
    ])
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({ targetRef: 'b'.repeat(40), targetRefStyle: 'sha' }),
    )
    vi.mocked(promptUpdateSelection).mockResolvedValue([])

    run()

    await vi.waitFor(() => {
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('No updates applied'),
      )
    })

    expect(applyUpdates).not.toHaveBeenCalled()
    expect(vi.mocked(printSkippedWarning).mock.calls).toHaveLength(1)
  })

  it('explains a rate limit failure', async () => {
    process.argv = ['node', 'actions-up']
    class GitHubRateLimitError extends Error {
      public override name = 'GitHubRateLimitError'
    }
    vi.mocked(scanGitHubActions).mockRejectedValue(
      new GitHubRateLimitError('GitHub API rate limit exceeded.'),
    )

    run()

    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Rate Limit Exceeded'),
    )
  })

  it('reports a thrown value that is not an error', async () => {
    process.argv = ['node', 'actions-up']
    vi.mocked(scanGitHubActions).mockRejectedValue('plain string')

    run()

    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error:'),
      'plain string',
    )
  })

  it('ignores excludes that compile to no pattern', async () => {
    process.argv = ['node', 'actions-up', '--exclude', '[', '--json']
    let consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({ hasUpdate: false, status: 'ok' }),
    ])

    run()

    await vi.waitFor(() => {
      expect(stdoutWriteSpy.mock.calls).toHaveLength(1)
    })

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Invalid regex exclude: [',
      expect.any(SyntaxError),
    )
    expect(checkUpdates).toHaveBeenCalledWith(
      [action],
      undefined,
      expect.anything(),
    )
  })

  it('keeps a sha pin as is when its comment records no version', async () => {
    process.argv = ['node', 'actions-up', '--mode', 'minor']
    let action = { ...createUpdate().action, comment: ' renovate: pin' }
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({ currentVersion: 'e'.repeat(40), action }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      reason: 'no-candidate',
      update: null,
    })

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(printModeWarning).mock.calls).toHaveLength(1)
    })

    expect(getCompatibleUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ currentVersion: 'e'.repeat(40) }),
    )
  })

  it('prints every warning alongside available updates', async () => {
    process.argv = ['node', 'actions-up', '--mode', 'minor', '--dry-run']
    let { action } = createUpdate()
    vi.mocked(scanGitHubActions).mockResolvedValue(createScanResult([action]))
    vi.mocked(checkUpdates).mockResolvedValue([
      createUpdate({
        skipReason: 'branch',
        status: 'skipped',
        hasUpdate: false,
      }),
      createUpdate({
        action: { ...action, comment: ' v9.0.0' },
        currentVersion: 'c'.repeat(40),
        latestVersion: 'v4.0.0',
      }),
      createUpdate({
        currentVersion: 'v3.0.0',
        publishedAt: new Date(),
        latestVersion: 'v3.1.0',
      }),
      createUpdate({
        publishedAt: new Date('2020-01-01T00:00:00Z'),
        currentVersion: 'v3.0.0',
        latestVersion: 'v4.0.0',
      }),
      createUpdate({
        publishedAt: new Date('2020-01-01T00:00:00Z'),
        action: { ...action, file: undefined },
        currentVersion: 'v3.0.0',
        latestVersion: 'v3.1.0',
      }),
    ])
    vi.mocked(getCompatibleUpdate).mockResolvedValue({
      reason: 'no-candidate',
      update: null,
    })
    vi.mocked(resolveTargetReference).mockResolvedValue(
      createUpdate({
        targetRefRateLimited: true,
        targetRefStyle: 'tag',
        targetRef: 'v3.1.0',
      }),
    )

    run()

    await vi.waitFor(() => {
      expect(vi.mocked(printRateLimitWarning).mock.calls).toHaveLength(1)
    })

    expect(vi.mocked(printSkippedWarning).mock.calls).toHaveLength(1)
    expect(vi.mocked(printModeWarning).mock.calls).toHaveLength(1)
    expect(vi.mocked(printMinAgeWarning).mock.calls).toHaveLength(1)
    expect(vi.mocked(printDowngradeWarning).mock.calls).toHaveLength(1)
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown'),
    )
  })
})
