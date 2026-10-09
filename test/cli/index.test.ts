import type { MockInstance, Mock } from 'vitest'
import type { Spinner } from 'nanospinner'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type { buildJsonReport } from '../../cli/build-json-report'
import type { GitHubAction } from '../../types/github-action'
import type { ActionUpdate } from '../../types/action-update'
import type { GitHubClient } from '../../types/github-client'
import type { ScanResult } from '../../types/scan-result'
import type { TagInfo } from '../../types/tag-info'

import { promptUpdateSelection } from '../../core/interactive/prompt-update-selection'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { createGitHubClient } from '../../core/api/create-github-client'
import { applyUpdates } from '../../core/ast/update/apply-updates'
import { createMockClient } from '../helpers/create-mock-client'
import { shouldIgnore } from '../../core/ignore/should-ignore'
import { stripAnsi } from '../../core/interactive/strip-ansi'
import { findRepoRoot } from '../../core/fs/find-repo-root'
import { checkUpdates } from '../../core/api/check-updates'
import { scanRecursive } from '../../core/scan-recursive'
import { scanGitHubActions } from '../../core/index'
import { version } from '../../package.json'
import { run } from '../../cli/index'

/**
 * Machine-readable report printed by `--json`.
 */
type JsonReport = ReturnType<typeof buildJsonReport>

/**
 * Matches the header of a notice by the words that set it apart from the other
 * notices. The printers' own tests pin the full wording.
 *
 * @param words - Distinguishing words of the header.
 * @returns Matcher for the printed header.
 */
function noticeAbout(words: string): string {
  return expect.stringContaining(words) as string
}

/**
 * Clock of every test.
 */
const NOW = '2026-10-03T12:00:00.000Z'

/**
 * Release dates around the seven-day cool-down the tests ask for with
 * `--min-age 7`: exactly `NOW` minus seven days, one millisecond later, two and
 * a half days before `NOW`, and long before any cool-down.
 */
const RELEASED_AT_COOL_DOWN_EDGE = '2026-09-26T12:00:00.000Z'
const RELEASED_JUST_INSIDE_COOL_DOWN = '2026-09-26T12:00:00.001Z'
const RELEASED_INSIDE_COOL_DOWN = '2026-10-01T00:00:00.000Z'
const RELEASED_LONG_AGO = '2026-08-01T00:00:00.000Z'

const WORKFLOW_FILE = '/repo/.github/workflows/ci.yml'
const RELEASE_WORKFLOW_FILE = '/repo/.github/workflows/release.yml'

const LATEST_SHA = 'b4ffde65f46336ab88eb53be808477a3936bae11'
const COMPATIBLE_SHA = 'f43a0e5ff2bd294095638e18286ca9a3d1956744'
const SECOND_COMPATIBLE_SHA = '0ad4b8fadaa221de15dcec353f45205ec38ea70b'
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020'

/**
 * Commit of a SHA pin, free of digits, so nothing in it can be read as a
 * version number.
 */
const PINNED_SHA = 'e'.repeat(40)

const BANNER = '🚀 Actions Up!'
const DRY_RUN_HEADER = '📋 Dry Run - No changes will be made'
const UP_TO_DATE = '✨ Everything is already at the latest version!'

const BRANCH_NOTICE = noticeAbout('pinned to branches')
const STYLE_NOTICE = noticeAbout('could not be updated with the current style')
const MAJOR_HELD_NOTICE = noticeAbout('due to major updates')
const MAJOR_OR_MINOR_HELD_NOTICE = noticeAbout('due to major/minor updates')
const COOL_DOWN_NOTICE = noticeAbout('released less than 7 days ago')
const DOWNGRADE_NOTICE = noticeAbout('would downgrade')
const RATE_LIMIT_NOTICE = noticeAbout('Tag validation was rate limited')

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

/**
 * A fixed catalog, so runner expectations do not change whenever the bundled
 * one gains or retires an image.
 */
vi.mock(import('../../core/runners/known-runner-labels'), () => ({
  KNOWN_RUNNER_IMAGES: {
    ubuntu: [
      { version: '22.04' },
      { version: '24.04' },
      { version: '26.04', preview: true },
    ],
    windows: [{ version: '2022' }, { version: '2025' }],
    macos: [{ version: '14' }, { version: '15' }],
  },
}))
vi.mock(import('../../core/interactive/prompt-update-selection'))
vi.mock(import('../../core/api/create-github-client'))
vi.mock(import('../../core/ast/update/apply-updates'))
vi.mock(import('../../core/ignore/should-ignore'))
vi.mock(import('../../core/fs/find-repo-root'))
vi.mock(import('../../core/api/check-updates'))
vi.mock(import('../../core/scan-recursive'))
vi.mock(import('../../core/index'))

describe('run', () => {
  let originalArgv: string[]

  let consoleInfoSpy: MockInstance<typeof console.info>
  let consoleErrorSpy: MockInstance<typeof console.error>
  let consoleWarnSpy: MockInstance<typeof console.warn>
  let stdoutWriteSpy: MockInstance<typeof process.stdout.write>
  let processExitSpy: MockInstance<typeof process.exit>
  let cwdSpy: MockInstance<typeof process.cwd>

  /**
   * Action reference as the scanner reports it: an absolute file path and no
   * `uses` string.
   *
   * @param overrides - Fields to replace.
   * @returns Scanned action reference.
   */
  function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
    return {
      name: 'actions/checkout',
      file: WORKFLOW_FILE,
      type: 'external',
      version: 'v3',
      job: 'build',
      line: 14,
      ...overrides,
    }
  }

  /**
   * SHA pin as the scanner reports it, with the version comment written next to
   * it.
   *
   * @param overrides - Fields to replace.
   * @returns Scanned SHA-pinned action reference.
   */
  function makeShaPin(overrides: Partial<GitHubAction> = {}): GitHubAction {
    return makeAction({ version: PINNED_SHA, comment: ' v3.6.0', ...overrides })
  }

  /**
   * `runs-on` label as the scanner reports it.
   *
   * @param overrides - Fields to replace.
   * @returns Scanned runner label.
   */
  function makeRunner(overrides: Partial<GitHubAction> = {}): GitHubAction {
    return {
      version: 'ubuntu-22.04',
      name: 'runner/ubuntu',
      file: WORKFLOW_FILE,
      type: 'runner',
      job: 'build',
      line: 9,
      ...overrides,
    }
  }

  /**
   * Update check answer for a tag reference: a newer, long published major
   * release.
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
   * Update check answer for a SHA pin.
   *
   * @param pin - Scanned SHA pin the answer belongs to.
   * @param overrides - Fields to replace.
   * @returns Update found by the update check.
   */
  function makePinUpdate(
    pin: GitHubAction,
    overrides: Partial<ActionUpdate> = {},
  ): ActionUpdate {
    return makeUpdate(pin, { currentRefType: 'sha', ...overrides })
  }

  /**
   * Update check answer for a reference pinned to a branch, which the check
   * skips unless branches are included.
   *
   * @param action - Scanned action the answer belongs to.
   * @returns Skipped entry reported by the update check.
   */
  function makeBranchSkip(action: GitHubAction): ActionUpdate {
    return {
      currentVersion: action.version ?? null,
      currentRefType: 'branch',
      skipReason: 'branch',
      latestVersion: null,
      status: 'skipped',
      publishedAt: null,
      isBreaking: false,
      hasUpdate: false,
      latestSha: null,
      action,
    }
  }

  /**
   * Scan result holding the given entries.
   *
   * @param entries - Scanned actions and runner labels.
   * @param layout - Workflow files and composite action directories found.
   * @param layout.workflows - Workflow files found.
   * @param layout.compositeActions - Composite action directories found.
   * @returns What the scanner reports for the repository.
   */
  function makeScanResult(
    entries: GitHubAction[],
    layout: { compositeActions?: string[]; workflows?: string[] } = {},
  ): ScanResult {
    let { workflows = ['.github/workflows/ci.yml'], compositeActions = [] } =
      layout
    return {
      compositeActions: new Map(compositeActions.map(path => [path, path])),
      workflows: new Map(workflows.map(path => [path, entries])),
      actions: entries,
    }
  }

  /**
   * Tag of an action repository as the GitHub API describes it.
   *
   * @param tag - Tag name.
   * @param sha - Commit the tag points to.
   * @param publishedAt - Publication date, null when unknown.
   * @returns Tag metadata.
   */
  function makeTag(
    tag: string,
    sha: string,
    publishedAt: string | null = null,
  ): TagInfo {
    return {
      date: publishedAt === null ? null : new Date(publishedAt),
      message: null,
      sha,
      tag,
    }
  }

  /**
   * Lets the scan find the given entries.
   *
   * @param entries - Scanned actions and runner labels.
   */
  function arrangeScan(...entries: GitHubAction[]): void {
    vi.mocked(scanGitHubActions).mockResolvedValue(makeScanResult(entries))
  }

  /**
   * Lets the scan find the actions of the given updates plus the runners, and
   * lets the update check answer with the updates of the actions it is asked
   * about, as the GitHub API would.
   *
   * @param scenario - Entries of the repository.
   * @param scenario.updates - Update check answers, one per scanned action.
   * @param scenario.runners - Scanned runner labels.
   */
  function arrangeRun(scenario: {
    updates?: ActionUpdate[]
    runners?: GitHubAction[]
  }): void {
    let { updates = [], runners = [] } = scenario
    arrangeScan(...updates.map(update => update.action), ...runners)
    vi.mocked(checkUpdates).mockImplementation(actions =>
      Promise.resolve(
        updates.filter(update => actions.includes(update.action)),
      ),
    )
  }

  /**
   * Lets the GitHub API know the tags of the given repositories: the tag
   * listing, the commit of each tag and its publication date. Every other
   * repository and tag does not exist.
   *
   * @param tagsByRepo - Tags per `owner/repo`.
   * @returns Tag listing request handler, to count the listings requested.
   */
  function arrangeTags(tagsByRepo: Record<string, TagInfo[]>): {
    getAllTags: Mock<GitHubClient['getAllTags']>
  } {
    function tagsOf(owner: string, repo: string): TagInfo[] {
      return tagsByRepo[`${owner}/${repo}`] ?? []
    }
    function findTag(
      owner: string,
      repo: string,
      name: string,
    ): TagInfo | null {
      return tagsOf(owner, repo).find(({ tag }) => tag === name) ?? null
    }
    /**
     * The listing names each tag and its commit but carries no dates.
     */
    let getAllTags = vi.fn<GitHubClient['getAllTags']>((owner, repo) =>
      Promise.resolve(
        tagsOf(owner, repo).map(({ sha, tag }) => ({
          message: null,
          date: null,
          sha,
          tag,
        })),
      ),
    )
    vi.mocked(createGitHubClient).mockReturnValue(
      createMockClient({
        getTagSha: vi.fn<GitHubClient['getTagSha']>((owner, repo, name) =>
          Promise.resolve(findTag(owner, repo, name)?.sha ?? null),
        ),
        getTagInfo: vi.fn<GitHubClient['getTagInfo']>((owner, repo, name) =>
          Promise.resolve(findTag(owner, repo, name)),
        ),
        getAllTags,
      }),
    )
    return { getAllTags }
  }

  /**
   * Lets every tag lookup hit the GitHub API rate limit.
   */
  function arrangeRateLimitedTagLookups(): void {
    vi.mocked(createGitHubClient).mockReturnValue(
      createMockClient({
        getTagSha: vi
          .fn<GitHubClient['getTagSha']>()
          .mockRejectedValue(new GitHubRateLimitError(new Date(NOW))),
      }),
    )
  }

  /**
   * Lets the given lines carry an ignore comment.
   *
   * @param locations - Ignored lines as `file:line`.
   */
  function arrangeIgnoreComments(...locations: string[]): void {
    vi.mocked(shouldIgnore).mockImplementation((file, line) =>
      Promise.resolve(locations.includes(`${file}:${line}`)),
    )
  }

  /**
   * Runs the CLI and waits until the update pipeline it starts has settled.
   *
   * `run()` does not return its promise. `vi.dynamicImportSettled()` waits for
   * one real `setTimeout(0)` tick and for the CLI's lazy imports, and every
   * collaborator in this file resolves through microtasks, so the whole
   * pipeline has finished by then. A collaborator that waits on a real timer
   * would break this assumption.
   *
   * @param argv - Arguments passed after the executable name.
   */
  async function runCli(...argv: string[]): Promise<void> {
    process.argv = ['node', 'actions-up', ...argv]
    run()
    await vi.dynamicImportSettled()
  }

  /**
   * Text printed with `console.info`, one entry per call, without colors and
   * surrounding line breaks.
   *
   * @returns Printed entries.
   */
  function printedLines(): string[] {
    return consoleInfoSpy.mock.calls.map(([text]) =>
      stripAnsi(String(text)).replaceAll(/^\n+|\n+$/gu, ''),
    )
  }

  /**
   * Text printed with `console.error`, one entry per call, without colors and
   * surrounding line breaks.
   *
   * @returns Printed entries.
   */
  function printedErrors(): string[] {
    return consoleErrorSpy.mock.calls.map(parts =>
      stripAnsi(parts.map(String).join(' ')).replaceAll(/^\n+|\n+$/gu, ''),
    )
  }

  /**
   * Messages the spinners finished with, without colors.
   *
   * @returns Spinner results in order.
   */
  function spinnerResults(): string[] {
    return vi
      .mocked(spinnerMock.success)
      .mock.calls.map(([text]) => stripAnsi(text as string))
  }

  /**
   * Actions sent to the update check, one list per request.
   *
   * @returns Requested actions.
   */
  function checkedActions(): GitHubAction[][] {
    return vi.mocked(checkUpdates).mock.calls.map(([actions]) => actions)
  }

  /**
   * Report written to stdout by `--json`.
   *
   * @returns Parsed report.
   */
  function readJsonReport(): JsonReport {
    let [output] = stdoutWriteSpy.mock.calls.at(0) ?? []
    return JSON.parse(String(output)) as JsonReport
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
    vi.stubEnv('GITHUB_TOKEN', undefined)
    originalArgv = process.argv

    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/repo')

    vi.mocked(findRepoRoot).mockResolvedValue('/repo')
    vi.mocked(shouldIgnore).mockResolvedValue(false)
    vi.mocked(createGitHubClient).mockReturnValue(createMockClient())
    vi.mocked(scanGitHubActions).mockResolvedValue(makeScanResult([]))
    vi.mocked(scanRecursive).mockResolvedValue(makeScanResult([]))
    vi.mocked(checkUpdates).mockResolvedValue([])
    vi.mocked(promptUpdateSelection).mockResolvedValue([])
    vi.mocked(applyUpdates).mockResolvedValue()
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.restoreAllMocks()
    // CSpell:disable-next-line -- Vitest API name.
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('command line', () => {
    it('prints the help text without scanning', async () => {
      await runCli('--help')

      expect(printedLines()).toStrictEqual([
        expect.stringContaining('Usage:\n  $ actions-up [options]'),
      ])
      expect(scanGitHubActions).not.toHaveBeenCalled()
    })

    it('prints the version without scanning', async () => {
      await runCli('--version')

      expect(printedLines()).toStrictEqual([
        expect.stringContaining(`actions-up/${version} `),
      ])
      expect(scanGitHubActions).not.toHaveBeenCalled()
    })

    it('reports an invalid argument and exits with code 1', async () => {
      /**
       * The real `process.exit` never returns.
       */
      processExitSpy.mockImplementation(() => {
        throw new Error('process.exit')
      })

      await expect(runCli('--min-age', 'soon')).rejects.toThrow('process.exit')

      expect(processExitSpy).toHaveBeenCalledExactlyOnceWith(1)
      expect(printedErrors()).toStrictEqual([
        'Error: Invalid --min-age "soon". Expected a non-negative number.',
      ])
    })

    it('refuses to combine --json with --yes and exits with code 1', async () => {
      await runCli('--json', '--yes')

      expect(processExitSpy).toHaveBeenCalledExactlyOnceWith(1)
      expect(printedErrors()).toStrictEqual([
        'Error: --json cannot be used with --yes',
      ])
    })
  })

  describe('scan', () => {
    it('scans the .github directory at the repository root from a subdirectory', async () => {
      cwdSpy.mockReturnValue('/repo/packages/app')

      await runCli()

      expect(scanGitHubActions).toHaveBeenCalledExactlyOnceWith(
        '/repo',
        '.github',
      )
    })

    it('scans a --dir directory at the repository root from a subdirectory', async () => {
      cwdSpy.mockReturnValue('/repo/packages/app')

      await runCli('--dir', '.gitea')

      expect(scanGitHubActions).toHaveBeenCalledExactlyOnceWith(
        '/repo',
        '.gitea',
      )
    })

    it('scans the .github directory of the current directory when no repository root is found', async () => {
      cwdSpy.mockReturnValue('/tmp/checkout')
      vi.mocked(findRepoRoot).mockResolvedValue(null)

      await runCli()

      expect(scanGitHubActions).toHaveBeenCalledExactlyOnceWith(
        '/tmp/checkout',
        '.github',
      )
    })

    it('scans recursively from the current directory without looking for a repository root', async () => {
      cwdSpy.mockReturnValue('/repo/packages/app')

      await runCli('--recursive')

      expect(scanRecursive).toHaveBeenCalledExactlyOnceWith(
        '/repo/packages/app',
        '.',
      )
      expect(findRepoRoot).not.toHaveBeenCalled()
      expect(scanGitHubActions).not.toHaveBeenCalled()
    })

    it('checks the actions of every --dir directory', async () => {
      let workflowAction = makeAction()
      let giteaAction = makeAction({
        file: '/repo/.gitea/workflows/ci.yml',
        name: 'actions/setup-node',
      })
      let scans: Record<string, ScanResult> = {
        '.github': makeScanResult([workflowAction]),
        '.gitea': makeScanResult([giteaAction]),
      }
      vi.mocked(scanGitHubActions).mockImplementation((_root, directory) =>
        Promise.resolve(scans[String(directory)]!),
      )

      await runCli('--dir', '.github', '--dir', '.gitea')

      expect(checkedActions()).toStrictEqual([[workflowAction, giteaAction]])
    })

    it.each([
      {
        summary: 'Found 1 action in 1 workflow and 0 composite actions',
        scan: makeScanResult([makeAction()]),
      },
      {
        scan: makeScanResult(
          [
            makeAction(),
            makeAction({ name: 'actions/cache', line: 20 }),
            makeRunner(),
            makeRunner({ version: 'windows-2025', name: 'runner/windows' }),
          ],
          {
            workflows: [
              '.github/workflows/ci.yml',
              '.github/workflows/release.yml',
            ],
            compositeActions: ['.github/actions/setup'],
          },
        ),
        summary:
          'Found 2 actions and 2 runners in 2 workflows and 1 composite action',
      },
      {
        summary:
          'Found 0 actions and 1 runner in 1 workflow and 0 composite actions',
        scan: makeScanResult([makeRunner()]),
      },
    ])('summarizes the scan as "$summary"', async ({ summary, scan }) => {
      vi.mocked(scanGitHubActions).mockResolvedValue(scan)

      await runCli('--dry-run')

      expect(spinnerResults().at(0)).toBe(summary)
    })

    it('shows progress while scanning and while checking for updates', async () => {
      arrangeRun({ updates: [makeUpdate(makeAction())] })

      await runCli('--dry-run')

      expect(createSpinnerMock.mock.calls).toStrictEqual([
        ['Scanning GitHub Actions...'],
        ['Checking for updates...'],
      ])
    })

    it('reports a repository without actions', async () => {
      await runCli()

      expect(printedLines()).toStrictEqual([
        BANNER,
        '✨ No GitHub Actions found in this repository',
      ])
    })

    it('reports a repository without actions in JSON mode', async () => {
      await runCli('--json')

      expect(readJsonReport()).toMatchObject({
        summary: { totalActionsChecked: 0, totalActions: 0 },
        status: 'no-actions-found',
        updates: [],
      })
    })
  })

  describe('excludes', () => {
    it('checks only the actions that no exclude pattern matches', async () => {
      let setupNode = makeAction({ name: 'actions/setup-node', version: 'v4' })
      arrangeScan(
        makeAction(),
        makeAction({ name: 'actions/cache', line: 20 }),
        setupNode,
      )

      await runCli('--exclude', 'actions/checkout, actions/cache')

      expect(checkedActions()).toStrictEqual([[setupNode]])
    })

    it('reports that nothing is left to check once every entry is excluded', async () => {
      arrangeScan(makeAction())

      await runCli('--exclude', '^actions/')

      expect(spinnerResults()).toContain('No entries to check after excludes')
      expect(printedLines()).toStrictEqual([
        BANNER,
        '✨ Nothing to check after excludes',
      ])
    })

    it('reports that nothing is left to check in JSON mode', async () => {
      arrangeScan(makeAction())

      await runCli(
        '--json',
        '--exclude',
        'actions/checkout',
        '--exclude',
        'actions/cache',
      )

      expect(readJsonReport()).toMatchObject({
        summary: { totalActionsChecked: 0, totalActions: 1 },
        status: 'nothing-to-check',
      })
    })

    it('excludes runners by name pattern', async () => {
      arrangeScan(makeRunner())

      await runCli('--yes', '--exclude', '^runner/')

      expect(printedLines()).toStrictEqual([
        BANNER,
        '✨ Nothing to check after excludes',
      ])
    })

    it('updates a runner that no exclude pattern matches', async () => {
      arrangeScan(makeRunner())

      await runCli('--yes', '--exclude', 'actions/checkout')

      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ targetRef: 'ubuntu-24.04' }),
      ])
    })

    it('excludes every occurrence when the pattern carries the global flag', async () => {
      arrangeScan(makeRunner(), makeRunner({ job: 'test', line: 31 }))

      await runCli('--yes', '--exclude', String.raw`/^runner\//g`)

      expect(printedLines()).toStrictEqual([
        BANNER,
        '✨ Nothing to check after excludes',
      ])
    })

    it('warns about an exclude pattern that does not compile and excludes nothing', async () => {
      let action = makeAction()
      arrangeScan(action)

      await runCli('--exclude', '[')

      expect(consoleWarnSpy).toHaveBeenCalledExactlyOnceWith(
        'Invalid regex exclude: [',
        expect.any(SyntaxError),
      )
      expect(checkedActions()).toStrictEqual([[action]])
    })

    it('lets --exclude win over --min-age-exclude', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ name: 'my-org/deploy', version: 'v1.4.0' }), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v1.5.0',
            isBreaking: false,
          }),
        ],
      })

      await runCli(
        '--min-age',
        '7',
        '--exclude',
        '^my-org/',
        '--min-age-exclude',
        '^my-org/',
        '--dry-run',
      )

      expect(printedLines()).toStrictEqual([
        BANNER,
        '✨ Nothing to check after excludes',
      ])
    })
  })

  describe('update check', () => {
    it('authenticates GitHub requests with the GITHUB_TOKEN environment variable', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_exampleToken')
      arrangeScan(makeAction())

      await runCli()

      expect(createGitHubClient).toHaveBeenCalledExactlyOnceWith(
        'ghp_exampleToken',
      )
      expect(checkUpdates).toHaveBeenCalledExactlyOnceWith(
        expect.any(Array),
        'ghp_exampleToken',
        expect.anything(),
      )
    })

    it.each([
      {
        lookup: { includeBranches: false, preferTags: false, style: 'sha' },
        flags: 'by default',
        argv: [],
      },
      {
        lookup: { includeBranches: true, style: 'preserve', preferTags: true },
        argv: ['--include-branches', '--prefer-tags', '--style', 'preserve'],
        flags: 'with --include-branches, --prefer-tags and --style',
      },
    ])('looks updates up as asked $flags', async ({ lookup, argv }) => {
      arrangeScan(makeAction())

      await runCli(...argv)

      expect(vi.mocked(checkUpdates).mock.lastCall?.[2]).toMatchObject(lookup)
    })
  })

  describe('ignore comments', () => {
    it('leaves out an update whose line carries an ignore comment', async () => {
      let ignored = makeAction({ name: 'actions/cache', line: 20 })
      arrangeRun({
        updates: [
          makeUpdate(makeAction()),
          makeUpdate(ignored, { latestVersion: 'v4.2.0' }),
        ],
      })
      arrangeIgnoreComments(`${ignored.file}:${ignored.line}`)

      await runCli('--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v3 → v4.2.2 (b4ffde6)`,
        '1 entry would be updated',
      ])
    })

    it('leaves out a runner whose line carries an ignore comment', async () => {
      let action = makeAction()
      let ignored = makeRunner()
      arrangeRun({ updates: [makeUpdate(action)], runners: [ignored] })
      arrangeIgnoreComments(`${ignored.file}:${ignored.line}`)

      await runCli('--yes')

      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ action }),
      ])
    })

    it('keeps the updates in scan order when their ignore comments are read out of order', async () => {
      let slow = makeAction()
      let fast = makeAction({ name: 'actions/cache', line: 20 })
      arrangeRun({
        updates: [
          makeUpdate(slow),
          makeUpdate(fast, { latestVersion: 'v4.2.0' }),
        ],
      })
      vi.mocked(shouldIgnore).mockImplementation(async (_file, line) => {
        if (line === slow.line) {
          await Promise.resolve()
          await Promise.resolve()
        }
        return false
      })

      await runCli('--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v3 → v4.2.2 (b4ffde6)`,
        `${WORKFLOW_FILE}:\nactions/cache: v3 → v4.2.0 (b4ffde6)`,
        '2 entries would be updated',
      ])
    })

    it('keeps the runners in scan order when their ignore comments are read out of order', async () => {
      let slow = makeRunner()
      let fast = makeRunner({
        version: 'windows-2022',
        name: 'runner/windows',
        line: 30,
      })
      arrangeScan(slow, fast)
      vi.mocked(shouldIgnore).mockImplementation(async (_file, line) => {
        if (line === slow.line) {
          await Promise.resolve()
          await Promise.resolve()
        }
        return false
      })

      await runCli('--yes')

      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({ action: slow }),
        expect.objectContaining({ action: fast }),
      ])
    })
  })

  describe('runner labels', () => {
    it('updates an outdated runner label to the newest stable image', async () => {
      let runner = makeRunner()
      arrangeScan(runner)

      await runCli('--yes')

      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        {
          currentVersion: 'ubuntu-22.04',
          latestVersion: 'ubuntu-24.04',
          targetRef: 'ubuntu-24.04',
          targetRefStyle: 'tag',
          publishedAt: null,
          isBreaking: true,
          latestSha: null,
          hasUpdate: true,
          action: runner,
          status: 'ok',
        },
      ])
    })

    it('keeps runner labels out of the update check', async () => {
      let action = makeAction()
      arrangeRun({ updates: [makeUpdate(action)], runners: [makeRunner()] })

      await runCli('--yes')

      expect(checkedActions()).toStrictEqual([[action]])
    })

    it('leaves a runner on the newest stable image alone', async () => {
      arrangeScan(makeRunner({ version: 'ubuntu-24.04' }))

      await runCli('--yes')

      expect(printedLines()).toStrictEqual([BANNER, UP_TO_DATE])
    })

    it('reports runners held back by a narrowed mode as blocked by the mode', async () => {
      arrangeScan(makeRunner())

      await runCli('--json', '--mode', 'minor')

      expect(readJsonReport()).toMatchObject({
        blockedByMode: [
          {
            action: { name: 'runner/ubuntu' },
            latestVersion: 'ubuntu-24.04',
          },
        ],
        runners: [],
      })
    })
  })

  describe('update mode', () => {
    it.each([
      {
        update: makeUpdate(makeAction({ version: 'v3.0.0' }), {
          latestVersion: 'v3.1.0',
          isBreaking: false,
        }),
        offered: 'actions/checkout: v3.0.0 → v3.1.0 (b4ffde6)',
        level: 'a minor update',
        mode: 'minor',
      },
      {
        update: makeUpdate(makeAction({ version: 'v3.0.0' }), {
          latestVersion: 'v3.0.1',
          isBreaking: false,
        }),
        offered: 'actions/checkout: v3.0.0 → v3.0.1 (b4ffde6)',
        level: 'a patch update',
        mode: 'minor',
      },
      {
        update: makeUpdate(makeAction({ version: 'v3.0.0' }), {
          latestVersion: 'v3.0.1',
          isBreaking: false,
        }),
        offered: 'actions/checkout: v3.0.0 → v3.0.1 (b4ffde6)',
        level: 'a patch update',
        mode: 'patch',
      },
      {
        update: makePinUpdate(makeShaPin(), {
          latestVersion: 'v3.6.0',
          isBreaking: false,
        }),
        offered: `actions/checkout: ${PINNED_SHA} → v3.6.0 (b4ffde6)`,
        level: 'a moved tag of the pinned version',
        mode: 'minor',
      },
      {
        update: makePinUpdate(makeShaPin(), {
          latestVersion: 'v3.6.0',
          isBreaking: false,
        }),
        offered: `actions/checkout: ${PINNED_SHA} → v3.6.0 (b4ffde6)`,
        level: 'a moved tag of the pinned version',
        mode: 'patch',
      },
    ])('offers $level in $mode mode', async ({ offered, update, mode }) => {
      arrangeRun({ updates: [update] })

      await runCli('--mode', mode, '--dry-run')

      expect(printedLines()).toContain(`${WORKFLOW_FILE}:\n${offered}`)
    })

    it.each([
      {
        notice: MAJOR_OR_MINOR_HELD_NOTICE,
        latestVersion: 'v3.1.0',
        level: 'a minor update',
        mode: 'patch',
      },
      {
        notice: MAJOR_HELD_NOTICE,
        latestVersion: 'v4.0.0',
        level: 'a major update',
        mode: 'minor',
      },
    ])(
      'holds back $level in $mode mode when no compatible release exists',
      async ({ latestVersion, notice, mode }) => {
        arrangeRun({
          updates: [
            makeUpdate(makeAction({ version: 'v3.0.0' }), { latestVersion }),
          ],
        })

        await runCli('--mode', mode)

        expect(printedLines()).toStrictEqual([
          BANNER,
          notice,
          '   • actions/checkout@v3.0.0',
          UP_TO_DATE,
        ])
      },
    )

    it('steps an update held back by the mode down to the newest compatible release', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v3.0.0' }), {
            latestVersion: 'v4.0.0',
          }),
        ],
      })
      arrangeTags({
        'actions/checkout': [
          makeTag('v4.0.0', LATEST_SHA, RELEASED_LONG_AGO),
          makeTag('v3.1.0', SECOND_COMPATIBLE_SHA, RELEASED_LONG_AGO),
          makeTag('v3.0.4', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
      })

      await runCli('--mode', 'patch', '--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v3.0.0 → v3.0.4 (f43a0e5)`,
        '1 entry would be updated',
      ])
    })

    it('measures a sha pin from the version recorded in its comment', async () => {
      arrangeRun({
        updates: [
          makePinUpdate(makeShaPin({ comment: ' v3.6.0' }), {
            latestVersion: 'v3.7.0',
            isBreaking: false,
          }),
        ],
      })

      await runCli('--mode', 'minor', '--dry-run')

      expect(printedLines()).toContain(
        `${WORKFLOW_FILE}:\nactions/checkout: ${PINNED_SHA} → v3.7.0 (b4ffde6)`,
      )
    })

    /**
     * Without a version comment the update level of a SHA pin is unknown. Its
     * hash starts with a 4, so reading a version out of the digits would take
     * the latest release for a minor or a patch update of v4.
     */
    it.each([
      { notice: MAJOR_HELD_NOTICE, latestVersion: 'v4.2.2', mode: 'minor' },
      {
        notice: MAJOR_OR_MINOR_HELD_NOTICE,
        latestVersion: 'v4.0.1',
        mode: 'patch',
      },
    ])(
      'holds back a sha pin without a version comment in $mode mode',
      async ({ latestVersion, notice, mode }) => {
        let sha = '4f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c'
        arrangeRun({
          updates: [
            makePinUpdate(
              makeShaPin({ comment: ' renovate: pin', version: sha }),
              { latestVersion },
            ),
          ],
        })

        await runCli('--mode', mode)

        expect(printedLines()).toStrictEqual([
          BANNER,
          notice,
          `   • actions/checkout@${sha}`,
          UP_TO_DATE,
        ])
      },
    )

    it('ignores a version comment next to a tag reference', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ comment: ' v4.3.0', version: 'v4' }), {
            latestVersion: 'v4.3.1',
            isBreaking: false,
          }),
        ],
      })

      await runCli('--mode', 'patch')

      expect(printedLines()).toStrictEqual([
        BANNER,
        MAJOR_OR_MINOR_HELD_NOTICE,
        '   • actions/checkout@v4',
        UP_TO_DATE,
      ])
    })

    it('lists the tags of a held back reference only once however many files mention it', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v3.0.0' }), {
            latestVersion: 'v4.0.0',
          }),
          makeUpdate(
            makeAction({ file: RELEASE_WORKFLOW_FILE, version: 'v3.0.0' }),
            { latestVersion: 'v4.0.0' },
          ),
        ],
      })
      let { getAllTags } = arrangeTags({
        'actions/checkout': [
          makeTag('v3.0.4', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
      })

      await runCli('--mode', 'patch', '--dry-run')

      expect(getAllTags).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        expect.any(Number),
      )
      expect(printedLines()).toContain('2 entries would be updated')
    })

    it('looks every held back version of an action up on its own', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v3.0.0' }), {
            latestVersion: 'v4.0.0',
          }),
          makeUpdate(
            makeAction({ file: RELEASE_WORKFLOW_FILE, version: 'v3.1.0' }),
            { latestVersion: 'v4.0.0' },
          ),
        ],
      })
      arrangeTags({
        'actions/checkout': [
          makeTag('v4.0.0', LATEST_SHA, RELEASED_LONG_AGO),
          makeTag('v3.1.2', SECOND_COMPATIBLE_SHA, RELEASED_LONG_AGO),
          makeTag('v3.0.4', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
      })

      await runCli('--mode', 'patch', '--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v3.0.0 → v3.0.4 (f43a0e5)`,
        `${RELEASE_WORKFLOW_FILE}:\nactions/checkout: v3.1.0 → v3.1.2 (0ad4b8f)`,
        '2 entries would be updated',
      ])
    })

    it.each([
      {
        tags: [
          makeTag('v4.0.0', LATEST_SHA, RELEASED_LONG_AGO),
          makeTag('v3.0.4', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
        update: makeUpdate(makeAction({ version: 'v3.0.0' }), {
          latestVersion: 'v4.0.0',
        }),
        change: 'stays within the major version',
        argv: ['--mode', 'patch'],
        marking: 'non-breaking',
        stepDown: 'v3.0.4',
        breaking: false,
      },
      {
        update: makeUpdate(makeAction({ version: 'v3.0.0' }), {
          publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
          latestVersion: 'v4.1.0',
        }),
        tags: [
          makeTag('v4.1.0', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v4.0.5', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
        change: 'crosses a major version',
        argv: ['--min-age', '7'],
        marking: 'breaking',
        stepDown: 'v4.0.5',
        breaking: true,
      },
    ])(
      'marks a step-down that $change as $marking',
      async ({ breaking, stepDown, update, argv, tags }) => {
        arrangeRun({ updates: [update] })
        arrangeTags({ 'actions/checkout': tags })

        await runCli('--json', ...argv)

        expect(readJsonReport().updates).toMatchObject([
          { latestVersion: stepDown, isBreaking: breaking },
        ])
      },
    )
  })

  describe('cool-down', () => {
    it.each([
      {
        publishedAt: new Date(RELEASED_AT_COOL_DOWN_EDGE),
        age: 'exactly the cool-down',
      },
      { publishedAt: null, age: 'unknown' },
    ])('offers a release whose age is $age', async ({ publishedAt }) => {
      arrangeRun({ updates: [makeUpdate(makeAction(), { publishedAt })] })

      await runCli('--min-age', '7', '--dry-run')

      expect(printedLines()).toContain(
        `${WORKFLOW_FILE}:\nactions/checkout: v3 → v4.2.2 (b4ffde6)`,
      )
    })

    it('holds back a release published one millisecond short of the cool-down', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction(), {
            publishedAt: new Date(RELEASED_JUST_INSIDE_COOL_DOWN),
          }),
        ],
      })

      await runCli('--min-age', '7')

      expect(printedLines()).toStrictEqual([
        BANNER,
        COOL_DOWN_NOTICE,
        '   • actions/checkout@v3',
        UP_TO_DATE,
      ])
    })

    it('steps down to the newest older release that clears the cool-down', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v0.6.0' }), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v0.6.3',
            isBreaking: false,
          }),
        ],
      })
      arrangeTags({
        'actions/checkout': [
          makeTag('v0.6.3', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v0.6.2', SECOND_COMPATIBLE_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v0.6.1', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
      })

      await runCli('--min-age', '7', '--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v0.6.0 → v0.6.1 (f43a0e5)`,
        '1 entry would be updated',
      ])
    })

    it('never steps up to a tag above the latest release', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v0.6.0' }), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v0.6.3',
            isBreaking: false,
          }),
        ],
      })
      let neverReleased = makeTag(
        'v0.6.4',
        SECOND_COMPATIBLE_SHA,
        RELEASED_LONG_AGO,
      )
      arrangeTags({
        'actions/checkout': [
          neverReleased,
          makeTag('v0.6.3', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v0.6.2', COMPATIBLE_SHA, RELEASED_LONG_AGO),
        ],
      })

      await runCli('--min-age', '7', '--dry-run')

      expect(printedLines()).toContain(
        `${WORKFLOW_FILE}:\nactions/checkout: v0.6.0 → v0.6.2 (f43a0e5)`,
      )
    })

    it.each([
      {
        tags: [
          makeTag('v4.0.0', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v3.1.0', COMPATIBLE_SHA, RELEASED_INSIDE_COOL_DOWN),
        ],
        situation: 'every newer release is still inside the cool-down',
        notice: COOL_DOWN_NOTICE,
        blamed: 'the cool-down',
        mode: 'major',
      },
      {
        situation: 'no tag of the action is listed',
        notice: COOL_DOWN_NOTICE,
        blamed: 'the cool-down',
        mode: 'major',
        tags: [],
      },
      {
        tags: [
          makeTag('v4.0.0', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v3.1.0', COMPATIBLE_SHA, RELEASED_INSIDE_COOL_DOWN),
        ],
        situation: 'the release the mode allows is still inside the cool-down',
        notice: COOL_DOWN_NOTICE,
        blamed: 'the cool-down',
        mode: 'minor',
      },
      {
        tags: [makeTag('v4.0.0', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN)],
        situation: 'the mode allows none of the listed releases',
        notice: MAJOR_HELD_NOTICE,
        blamed: 'the mode',
        mode: 'minor',
      },
    ])(
      'blames $blamed for a young major release when $situation in $mode mode',
      async ({ notice, mode, tags }) => {
        arrangeRun({
          updates: [
            makeUpdate(makeAction({ version: 'v3.0.0' }), {
              publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
              latestVersion: 'v4.0.0',
            }),
          ],
        })
        arrangeTags({ 'actions/checkout': tags })

        await runCli('--mode', mode, '--min-age', '7')

        expect(printedLines()).toStrictEqual([
          BANNER,
          notice,
          '   • actions/checkout@v3.0.0',
          UP_TO_DATE,
        ])
      },
    )

    it('names the actions held back by the cool-down in JSON mode', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v0.6.0' }), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v0.6.3',
            isBreaking: false,
          }),
        ],
      })
      arrangeTags({
        'actions/checkout': [
          makeTag('v0.6.3', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
        ],
      })

      await runCli('--json', '--min-age', '7')

      expect(readJsonReport()).toMatchObject({
        blockedByAge: [
          {
            action: { name: 'actions/checkout' },
            currentVersion: 'v0.6.0',
            latestVersion: 'v0.6.3',
          },
        ],
        summary: { totalBlockedByAge: 1 },
      })
    })

    it('offers a young release of an action matching --min-age-exclude', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ name: 'my-org/deploy', version: 'v0.6.0' }), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v0.6.3',
            isBreaking: false,
          }),
        ],
      })

      await runCli(
        '--min-age',
        '7',
        '--min-age-exclude',
        '^my-org/deploy$',
        '--dry-run',
      )

      expect(printedLines()).toContain(
        `${WORKFLOW_FILE}:\nmy-org/deploy: v0.6.0 → v0.6.3 (b4ffde6)`,
      )
    })

    it('keeps the cool-down for actions that no --min-age-exclude pattern matches', async () => {
      arrangeRun({
        updates: [
          makeAction({ version: 'v0.6.0' }),
          makeAction({ name: 'my-org/deploy', version: 'v0.6.0', line: 20 }),
          makeAction({
            name: 'not-my-org/deploy',
            version: 'v0.6.0',
            line: 26,
          }),
        ].map(action =>
          makeUpdate(action, {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v0.6.3',
            isBreaking: false,
          }),
        ),
      })
      /**
       * A pattern that matches no scanned action, next to one anchored at the
       * owner, so the look-alike `not-my-org` stays under the cool-down.
       */
      let unrelatedPattern = 'other/.*'
      let ownOrganizationPattern = '^my-org/'

      await runCli(
        '--min-age',
        '7',
        '--min-age-exclude',
        `${unrelatedPattern}, ${ownOrganizationPattern}`,
        '--dry-run',
      )

      expect(printedLines()).toStrictEqual([
        BANNER,
        COOL_DOWN_NOTICE,
        '   • actions/checkout@v0.6.0',
        '   • not-my-org/deploy@v0.6.0',
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nmy-org/deploy: v0.6.0 → v0.6.3 (b4ffde6)`,
        '1 entry would be updated',
      ])
    })

    it('steps an exempt action down by the mode without the cool-down', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ name: 'my-org/deploy', version: 'v3.0.0' }), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
            latestVersion: 'v4.0.0',
          }),
        ],
      })
      arrangeTags({
        'my-org/deploy': [
          makeTag('v4.0.0', LATEST_SHA, RELEASED_INSIDE_COOL_DOWN),
          makeTag('v3.0.4', COMPATIBLE_SHA, RELEASED_INSIDE_COOL_DOWN),
        ],
      })

      await runCli(
        '--mode',
        'patch',
        '--min-age',
        '7',
        '--min-age-exclude',
        '^my-org/',
        '--dry-run',
      )

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nmy-org/deploy: v3.0.0 → v3.0.4 (f43a0e5)`,
        '1 entry would be updated',
      ])
    })

    it('keeps the cool-down and warns when a --min-age-exclude pattern does not compile', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction(), {
            publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
          }),
        ],
      })

      await runCli('--min-age', '7', '--min-age-exclude', '[')

      expect(consoleWarnSpy).toHaveBeenCalledExactlyOnceWith(
        'Invalid regex exclude: [',
        expect.any(SyntaxError),
      )
      expect(printedLines()).toContainEqual(COOL_DOWN_NOTICE)
    })
  })

  describe('target reference', () => {
    it('keeps a tag reference on a floating tag with --style preserve', async () => {
      arrangeRun({ updates: [makeUpdate(makeAction())] })
      arrangeTags({ 'actions/checkout': [makeTag('v4', LATEST_SHA)] })

      await runCli('--style', 'preserve', '--dry-run')

      expect(printedLines()).toContain(
        `${WORKFLOW_FILE}:\nactions/checkout: v3 → v4`,
      )
    })

    it('offers no update when the floating tag already points at the latest release', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ version: 'v4' }), { isBreaking: false }),
        ],
      })
      arrangeTags({ 'actions/checkout': [makeTag('v4', LATEST_SHA)] })

      await runCli('--style', 'semver')

      expect(printedLines()).toStrictEqual([BANNER, UP_TO_DATE])
    })

    it('skips an update whose target cannot be expressed in the chosen style', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction({ name: 'actions/cache' }), {
            latestSha: null,
          }),
        ],
      })

      await runCli()

      expect(printedLines()).toStrictEqual([
        BANNER,
        STYLE_NOTICE,
        '   • actions/cache@v3',
        UP_TO_DATE,
      ])
    })

    it('lists an update whose target cannot be expressed in the chosen style as skipped in JSON mode', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction()),
          makeUpdate(makeAction({ name: 'actions/cache', line: 20 }), {
            latestSha: null,
          }),
        ],
      })

      await runCli('--json')

      expect(readJsonReport()).toMatchObject({
        skipped: [
          {
            action: { name: 'actions/cache' },
            skipReason: 'unsupported-style',
            status: 'skipped',
            hasUpdate: false,
          },
        ],
        updates: [{ action: { name: 'actions/checkout' } }],
      })
    })

    it('validates the floating tag of a reference only once however many files mention it', async () => {
      let getTagSha = vi
        .fn<GitHubClient['getTagSha']>()
        .mockResolvedValue(LATEST_SHA)
      vi.mocked(createGitHubClient).mockReturnValue(
        createMockClient({ getTagSha }),
      )
      arrangeRun({
        updates: [
          makeUpdate(makeAction()),
          makeUpdate(makeAction({ file: RELEASE_WORKFLOW_FILE })),
        ],
      })

      await runCli('--style', 'preserve', '--dry-run')

      expect(getTagSha).toHaveBeenCalledExactlyOnceWith(
        'actions',
        'checkout',
        'v4',
      )
    })

    it('resolves the target of every distinct reference on its own', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction()),
          makeUpdate(makeAction({ name: 'actions/setup-node', line: 20 }), {
            latestSha: SETUP_NODE_SHA,
            latestVersion: 'v4.4.0',
          }),
        ],
      })
      arrangeTags({ 'actions/checkout': [makeTag('v4', LATEST_SHA)] })

      await runCli('--style', 'preserve', '--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v3 → v4`,
        `${WORKFLOW_FILE}:\nactions/setup-node: v3 → v4.4.0`,
        '2 entries would be updated',
      ])
    })
  })

  describe('notices', () => {
    it.each([
      {
        update: makeBranchSkip(
          makeAction({ name: 'actions/cache', version: 'main', line: 20 }),
        ),
        notice: [BRANCH_NOTICE, '   • actions/cache@main'],
        entry: 'a reference pinned to a branch',
        argv: [],
      },
      {
        update: makeUpdate(makeAction({ name: 'actions/cache', line: 20 }), {
          latestVersion: 'v4.2.0',
        }),
        notice: [MAJOR_HELD_NOTICE, '   • actions/cache@v3'],
        entry: 'an update held back by the mode',
        argv: ['--mode', 'minor'],
      },
      {
        update: makeUpdate(makeAction({ name: 'actions/cache', line: 20 }), {
          publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
          latestVersion: 'v4.2.0',
        }),
        notice: [COOL_DOWN_NOTICE, '   • actions/cache@v3'],
        entry: 'an update held back by the cool-down',
        argv: ['--min-age', '7'],
      },
      {
        update: makePinUpdate(
          makeShaPin({ name: 'actions/cache', comment: ' v4.3.0', line: 20 }),
          { latestVersion: 'v4.2.0' },
        ),
        notice: [DOWNGRADE_NOTICE, `   • actions/cache@${PINNED_SHA}`],
        entry: 'an update that would downgrade a sha pin',
        argv: [],
      },
    ])(
      'prints a notice about $entry and a blank line before the prompt',
      async ({ notice, update, argv }) => {
        let reachesThePrompt = makeUpdate(
          makeAction({ name: 'actions/setup-node', version: 'v4' }),
          { latestVersion: 'v4.4.0', isBreaking: false },
        )
        arrangeRun({ updates: [update, reachesThePrompt] })

        await runCli(...argv)

        expect(printedLines()).toStrictEqual([
          BANNER,
          ...notice,
          '',
          'No updates applied',
        ])
      },
    )

    it('prints a notice about updates whose tag validation was rate limited and a blank line before the prompt', async () => {
      let floatingTag = makeUpdate(makeAction())
      let exactVersion = makeUpdate(
        makeAction({ name: 'actions/setup-node', version: 'v4.0.0', line: 20 }),
        {
          latestSha: SETUP_NODE_SHA,
          latestVersion: 'v4.4.0',
          isBreaking: false,
        },
      )
      arrangeRun({ updates: [floatingTag, exactVersion] })
      arrangeRateLimitedTagLookups()

      await runCli('--style', 'preserve')

      expect(printedLines()).toStrictEqual([
        BANNER,
        RATE_LIMIT_NOTICE,
        '   • actions/checkout@v3',
        '',
        'No updates applied',
      ])
    })

    it('prints no notice and no blank line with --quiet', async () => {
      let pinnedToBranch = makeBranchSkip(
        makeAction({ name: 'actions/cache', version: 'main' }),
      )
      let heldByMode = makeUpdate(
        makeAction({ name: 'actions/upload-artifact' }),
        { latestVersion: 'v4.6.2' },
      )
      let heldByCoolDown = makeUpdate(
        makeAction({ name: 'actions/download-artifact', version: 'v4' }),
        {
          publishedAt: new Date(RELEASED_INSIDE_COOL_DOWN),
          latestVersion: 'v4.3.0',
          isBreaking: false,
        },
      )
      let wouldDowngrade = makePinUpdate(
        makeShaPin({ name: 'actions/setup-python', comment: ' v5.6.0' }),
        { latestVersion: 'v5.4.0', isBreaking: false },
      )
      let rateLimitedFloatingTag = makeUpdate(makeAction({ version: 'v4' }), {
        isBreaking: false,
      })
      arrangeRun({
        updates: [
          pinnedToBranch,
          heldByMode,
          heldByCoolDown,
          wouldDowngrade,
          rateLimitedFloatingTag,
        ],
      })
      arrangeRateLimitedTagLookups()

      await runCli(
        '--quiet',
        '--mode',
        'minor',
        '--min-age',
        '7',
        '--style',
        'preserve',
      )

      expect(printedLines()).toStrictEqual([BANNER, 'No updates applied'])
    })
  })

  describe('json report', () => {
    it('lists the available updates in the JSON report', async () => {
      arrangeRun({ updates: [makeUpdate(makeAction())] })

      await runCli('--json')

      expect(readJsonReport()).toMatchObject({
        updates: [
          {
            action: { name: 'actions/checkout' },
            latestVersion: 'v4.2.2',
            targetRefStyle: 'sha',
            targetRef: LATEST_SHA,
          },
        ],
        summary: { totalUpdates: 1 },
        status: 'updates-available',
      })
    })

    it('reports updates without prompting or writing files in JSON mode', async () => {
      arrangeRun({ updates: [makeUpdate(makeAction())] })

      await runCli('--json')

      expect(readJsonReport().status).toBe('updates-available')
      expect(promptUpdateSelection).not.toHaveBeenCalled()
      expect(applyUpdates).not.toHaveBeenCalled()
    })

    it('prints nothing besides the report in JSON mode', async () => {
      arrangeRun({
        updates: [
          makeUpdate(makeAction()),
          makeBranchSkip(
            makeAction({ name: 'actions/cache', version: 'main' }),
          ),
        ],
      })

      await runCli('--json')

      expect(consoleInfoSpy).not.toHaveBeenCalled()
      expect(createSpinnerMock).not.toHaveBeenCalled()
      expect(stdoutWriteSpy).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining('"schemaVersion": 1'),
      )
    })

    it('reports an up-to-date repository in JSON mode while listing what it skipped', async () => {
      arrangeRun({
        updates: [
          makePinUpdate(
            makeShaPin({ version: LATEST_SHA, comment: ' v4.2.2' }),
            { isBreaking: false, hasUpdate: false },
          ),
          makeBranchSkip(
            makeAction({ name: 'actions/cache', version: 'main' }),
          ),
        ],
      })

      await runCli('--json')

      expect(readJsonReport()).toMatchObject({
        skipped: [{ action: { name: 'actions/cache' }, skipReason: 'branch' }],
        status: 'up-to-date',
        updates: [],
      })
    })

    it.each([
      {
        options: {
          minAgeExcludePatterns: [],
          directories: ['.github'],
          includeBranches: false,
          excludePatterns: [],
          preferTags: false,
          reportOnly: true,
          recursive: false,
          mode: 'major',
          style: 'sha',
          json: true,
          minAge: 1,
        },
        flags: 'the defaults',
        argv: ['--json'],
      },
      {
        argv: [
          '--json',
          '--recursive',
          '--dir',
          'workflows',
          '--exclude',
          '^my-org/',
          '--min-age-exclude',
          '^my-org/, ^other-org/',
          '--include-branches',
          '--prefer-tags',
          '--min-age',
          '3',
          '--style',
          'preserve',
          '--mode',
          'minor',
        ],
        options: {
          minAgeExcludePatterns: ['^my-org/', '^other-org/'],
          excludePatterns: ['^my-org/'],
          directories: ['workflows'],
          includeBranches: true,
          style: 'preserve',
          preferTags: true,
          reportOnly: true,
          recursive: true,
          mode: 'minor',
          json: true,
          minAge: 3,
        },
        flags: 'every option',
      },
    ])('echoes $flags in the JSON report', async ({ options, argv }) => {
      await runCli(...argv)

      expect(readJsonReport().options).toStrictEqual(options)
    })

    it('reports a failure in JSON mode and exits with code 1', async () => {
      arrangeScan(makeAction())
      vi.mocked(checkUpdates).mockRejectedValue(new Error('fetch failed'))

      await runCli('--json')

      expect(printedErrors()).toStrictEqual(['Error: fetch failed'])
      expect(processExitSpy).toHaveBeenCalledExactlyOnceWith(1)
    })
  })

  describe('applying updates', () => {
    it('applies every eligible update, runners included, without prompting with --yes', async () => {
      let action = makeAction()
      let runner = makeRunner()
      arrangeRun({ updates: [makeUpdate(action)], runners: [runner] })

      await runCli('--yes')

      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        { ...makeUpdate(action), targetRefStyle: 'sha', targetRef: LATEST_SHA },
        expect.objectContaining({ targetRef: 'ubuntu-24.04', action: runner }),
      ])
      expect(promptUpdateSelection).not.toHaveBeenCalled()
    })

    it.each([
      {
        announcement: '🔄 Updating 1 entry...',
        count: 'a single entry',
        runners: [],
      },
      {
        announcement: '🔄 Updating 2 entries...',
        count: 'several entries',
        runners: [makeRunner()],
      },
    ])(
      'announces how many entries it applies with --yes for $count',
      async ({ announcement, runners }) => {
        arrangeRun({ updates: [makeUpdate(makeAction())], runners })

        await runCli('--yes')

        expect(printedLines()).toStrictEqual([
          BANNER,
          announcement,
          '✓ Updates applied successfully!',
        ])
      },
    )

    it('lists what it would update and applies nothing with --dry-run', async () => {
      arrangeRun({
        updates: [makeUpdate(makeAction())],
        runners: [makeRunner()],
      })

      await runCli('--dry-run')

      expect(printedLines()).toStrictEqual([
        BANNER,
        DRY_RUN_HEADER,
        `${WORKFLOW_FILE}:\nactions/checkout: v3 → v4.2.2 (b4ffde6)`,
        `${WORKFLOW_FILE}:\nrunner/ubuntu: ubuntu-22.04 → ubuntu-24.04`,
        '2 entries would be updated',
      ])
      expect(promptUpdateSelection).not.toHaveBeenCalled()
      expect(applyUpdates).not.toHaveBeenCalled()
    })

    it.each([
      {
        updates: [
          makeUpdate(makeAction(), {
            latestVersion: 'v3.6.0',
            isBreaking: false,
          }),
        ],
        found: 'Found 1 update available',
      },
      {
        updates: [
          makeUpdate(makeAction()),
          makeUpdate(
            makeAction({ name: 'actions/setup-node', version: 'v4' }),
            {
              latestVersion: 'v4.4.0',
              isBreaking: false,
            },
          ),
        ],
        found: 'Found 2 updates available (1 breaking)',
      },
    ])(
      'summarizes the available updates as "$found"',
      async ({ updates, found }) => {
        arrangeRun({ updates })

        await runCli('--dry-run')

        expect(spinnerResults()).toContain(found)
      },
    )

    it('reports that everything is up to date when no update is left', async () => {
      arrangeRun({
        updates: [
          makePinUpdate(
            makeShaPin({ version: LATEST_SHA, comment: ' v4.2.2' }),
            { isBreaking: false, hasUpdate: false },
          ),
        ],
      })

      await runCli()

      expect(spinnerResults()).toContain('All actions are up to date!')
      expect(printedLines()).toStrictEqual([BANNER, UP_TO_DATE])
    })

    it('applies only the updates picked in the prompt', async () => {
      let setupNode = makeAction({ name: 'actions/setup-node', line: 20 })
      arrangeRun({
        updates: [
          makeUpdate(makeAction()),
          makeUpdate(setupNode, {
            latestSha: SETUP_NODE_SHA,
            latestVersion: 'v4.4.0',
          }),
        ],
      })
      /**
       * The user picks every entry but the first one.
       */
      vi.mocked(promptUpdateSelection).mockImplementation(updates =>
        Promise.resolve(updates.slice(1)),
      )

      await runCli()

      expect(applyUpdates).toHaveBeenCalledExactlyOnceWith([
        expect.objectContaining({
          targetRef: SETUP_NODE_SHA,
          action: setupNode,
        }),
      ])
    })

    it.each([
      {
        announcement: '🔄 Updating 1 selected entry...',
        picked: 'a single entry',
        count: 1,
      },
      {
        announcement: '🔄 Updating 2 selected entries...',
        picked: 'several entries',
        count: 2,
      },
    ])(
      'announces how many picked entries it applies for $picked',
      async ({ announcement, count }) => {
        arrangeRun({
          updates: [
            makeUpdate(makeAction()),
            makeUpdate(makeAction({ name: 'actions/setup-node', line: 20 }), {
              latestVersion: 'v4.4.0',
            }),
          ],
        })
        vi.mocked(promptUpdateSelection).mockImplementation(updates =>
          Promise.resolve(updates.slice(0, count)),
        )

        await runCli()

        expect(printedLines()).toStrictEqual([
          BANNER,
          announcement,
          '✓ Updates applied successfully!',
        ])
      },
    )

    it.each([
      { cooldown: 'on', column: 'show', showAge: true, minAge: '7' },
      { cooldown: 'off', showAge: false, column: 'hide', minAge: '0' },
    ])(
      'asks the prompt to $column release ages when the cool-down is $cooldown',
      async ({ showAge, minAge }) => {
        arrangeRun({ updates: [makeUpdate(makeAction())] })

        await runCli('--min-age', minAge)

        expect(promptUpdateSelection).toHaveBeenCalledExactlyOnceWith(
          expect.any(Array),
          { showAge },
        )
      },
    )

    it.each([
      { outcome: 'cancelled', selection: null },
      { outcome: 'empty', selection: [] },
    ])(
      'applies nothing when the selection is $outcome',
      async ({ selection }) => {
        arrangeRun({ updates: [makeUpdate(makeAction())] })
        vi.mocked(promptUpdateSelection).mockResolvedValue(selection)

        await runCli()

        expect(applyUpdates).not.toHaveBeenCalled()
        expect(printedLines()).toStrictEqual([BANNER, 'No updates applied'])
      },
    )
  })

  describe('failures', () => {
    it('reports a failure and exits with code 1', async () => {
      arrangeScan(makeAction())
      vi.mocked(checkUpdates).mockRejectedValue(new Error('fetch failed'))

      await runCli()

      expect(spinnerMock.error).toHaveBeenCalledExactlyOnceWith('Failed')
      expect(printedErrors()).toStrictEqual(['Error: fetch failed'])
      expect(processExitSpy).toHaveBeenCalledExactlyOnceWith(1)
    })

    it('explains a rate limit failure and how to raise the limit', async () => {
      let error = new GitHubRateLimitError(new Date(NOW))
      arrangeScan(makeAction())
      vi.mocked(checkUpdates).mockRejectedValue(error)

      await runCli()

      expect(printedErrors()).toStrictEqual([
        '⚠️ Rate Limit Exceeded',
        error.message,
        'Example: GITHUB_TOKEN=ghp_xxxx actions-up',
      ])
      expect(processExitSpy).toHaveBeenCalledExactlyOnceWith(1)
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    it('reports a thrown value that is not an error', async () => {
      arrangeScan(makeAction())
      vi.mocked(checkUpdates).mockRejectedValue('socket hang up')

      await runCli()

      expect(printedErrors()).toStrictEqual(['Error: socket hang up'])
    })

    it('treats a runner entry without a label as already current', async () => {
      arrangeScan(makeRunner({ version: undefined }))

      await runCli('--yes')

      expect(printedLines()).toStrictEqual([BANNER, UP_TO_DATE])
    })

    it('labels a dry-run entry without a source file as unknown', async () => {
      arrangeRun({ updates: [makeUpdate(makeAction({ file: undefined }))] })

      await runCli('--dry-run')

      expect(printedLines()).toContain(
        'unknown:\nactions/checkout: v3 → v4.2.2 (b4ffde6)',
      )
    })
  })
})
