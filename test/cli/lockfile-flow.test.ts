import type { MockInstance } from 'vitest'

import {
  writeFile,
  realpath,
  readFile,
  mkdtemp,
  mkdir,
  rm,
} from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { delimiter, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

import type { ActionUpdate } from '../../types/action-update'
import type { GitHubAction } from '../../types/github-action'
import type { GitHubClient } from '../../types/github-client'

import { createGitHubClient } from '../../core/api/create-github-client'
import { makeLockfileText } from '../helpers/make-lockfile-text'
import { createMockClient } from '../helpers/create-mock-client'
import { stripAnsi } from '../../core/interactive/strip-ansi'
import { checkUpdates } from '../../core/api/check-updates'
import { run } from '../../cli/index'

vi.mock(import('../../core/api/check-updates'))
vi.mock(import('../../core/api/create-github-client'))

/**
 * What the stand-in for `gh` does when it is run for a relock.
 */
interface GhBehavior {
  /**
   * Files it writes, by their path from the directory it runs in, as
   * gh-actions-lock writes the lockfile and rewrites workflows.
   */
  writes?: Record<string, string>

  /**
   * What it prints to standard output.
   */
  report?: object

  /**
   * Code it exits with.
   */
  status?: number

  /**
   * Whether it waits for the test to let it go, so that the test can send a
   * signal while it runs.
   */
  hold?: boolean
}

/**
 * How the stand-in for `gh` was run for a relock.
 */
interface GhCall {
  /**
   * Variables of the lockfile support as the process saw them, absent when
   * unset.
   */
  env: Record<string, string>

  /**
   * Arguments after `gh`.
   */
  args: string[]

  /**
   * Physical working directory.
   */
  cwd: string
}

/**
 * Clock of every test.
 */
const NOW = '2026-10-03T12:00:00.000Z'

/**
 * Committer and author date of every commit the default branch holds, long
 * before any release of the tests.
 */
const ON_BRANCH_SINCE = '2026-07-15T00:00:00.000Z'

/**
 * Publication date of every release, long before any cool-down.
 */
const RELEASED_LONG_AGO = '2026-08-01T00:00:00.000Z'

const CHECKOUT_SHA = 'b4ffde65f46336ab88eb53be808477a3936bae11'

const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020'

const CACHE_SHA = '0057852bfaa89a56745cba8c7296529d2fc39830'

/**
 * Commit the lockfile pins `actions/checkout@v3` to before the run.
 */
const RECORDED_CHECKOUT_SHA = 'f43a0e5ff2bd294095638e18286ca9a3d1956744'

/**
 * Latest version and commit the update check finds for each repository.
 */
const LATEST: Record<string, { version: string; sha: string }> = {
  'actions/setup-node': { sha: SETUP_NODE_SHA, version: 'v4.4.0' },
  'actions/checkout': { version: 'v4.2.2', sha: CHECKOUT_SHA },
  'actions/cache': { version: 'v4.2.3', sha: CACHE_SHA },
}

const CI_KEY = '.github/workflows/ci.yml'

const RELEASE_KEY = '.github/workflows/release.yml'

const LOCKFILE_KEY = '.github/workflows/actions.lock'

/**
 * Flags of the relock after `actions-lock`, up to the workflows.
 */
const RELOCK_ARGUMENTS = [
  'actions-lock',
  '--no-onboard',
  '--no-narrow',
  '--no-interactive',
  '--json=findings,pins',
  '--',
]

/**
 * Stand-in for the GitHub CLI. `gh extension list` lists gh-actions-lock 0.5.1.
 * Any other command is taken for a relock: it records how it was run, waits
 * while the test holds it, writes the files the test gave it into the directory
 * it runs in, prints the report and exits with the code the test chose. A held
 * run gives up waiting after ten seconds, so that a failed test leaves no
 * process behind.
 */
const GH_STUB = `#!/bin/sh
dir=$(cd "$(dirname "$0")" && pwd -P)
if [ "$1" = extension ] && [ "$2" = list ]; then
  printf 'gh actions-lock\\tgithub/gh-actions-lock\\tv0.5.1\\n'
  exit 0
fi
{
  echo call
  printf 'cwd %s\\n' "$(pwd -P)"
  [ "\${GH_ACTIONS_LOCK_WORKFLOWS_DIR+set}" ] && printf 'env GH_ACTIONS_LOCK_WORKFLOWS_DIR=%s\\n' "$GH_ACTIONS_LOCK_WORKFLOWS_DIR"
  [ "\${GH_ACTIONS_LOCK_REPO_ROOT+set}" ] && printf 'env GH_ACTIONS_LOCK_REPO_ROOT=%s\\n' "$GH_ACTIONS_LOCK_REPO_ROOT"
  [ "\${GH_FORCE_TTY+set}" ] && printf 'env GH_FORCE_TTY=%s\\n' "$GH_FORCE_TTY"
  for argument in "$@"; do printf 'arg %s\\n' "$argument"; done
} >> "$dir/calls"
if [ -e "$dir/hold" ]; then
  : > "$dir/started"
  waited=0
  while [ ! -e "$dir/go" ] && [ "$waited" -lt 200 ]; do
    sleep 0.05
    waited=$((waited + 1))
  done
fi
if [ -d "$dir/writes" ]; then cp -R "$dir/writes/." .; fi
if [ -e "$dir/report" ]; then cat "$dir/report"; fi
exit "$(cat "$dir/status")"
`

/**
 * Update check answer for a scanned action of a repository `LATEST` knows.
 *
 * @param action - Scanned action.
 * @returns Update found by the update check, or none for another repository.
 */
function makeUpdate(action: GitHubAction): ActionUpdate[] {
  let latest = LATEST[action.name]
  return latest ?
      [
        {
          publishedAt: new Date(RELEASED_LONG_AGO),
          currentVersion: action.version ?? null,
          latestVersion: latest.version,
          currentRefType: 'tag',
          latestSha: latest.sha,
          isBreaking: true,
          hasUpdate: true,
          status: 'ok',
          action,
        },
      ]
    : []
}

/**
 * Text of a workflow whose job has one step per reference, with the given line
 * break.
 *
 * @param references - References of the steps.
 * @param lineBreak - Line break to join the lines with.
 * @returns Workflow YAML text.
 */
function makeWorkflowText(references: string[], lineBreak = '\n'): string {
  return [
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...references.map(reference => `      - uses: ${reference}`),
    '',
  ].join(lineBreak)
}

/**
 * Report gh-actions-lock prints for a run that pinned the given references.
 *
 * @param pins - Repository, reference and commit of each pin.
 * @returns What the command prints to standard output, before it is encoded as
 *   JSON.
 */
function makeReport(...pins: [string, string, string][]): object {
  return {
    pins: pins.map(([nwo, reference, sha]) => ({
      outcome: 'pinned',
      ref: reference,
      nwo,
      sha,
    })),
    findings: [],
  }
}

/**
 * Report gh-actions-lock prints for a run that blocked on a finding.
 */
const BLOCKED_REPORT = {
  findings: [
    {
      detail: 'ref v4.2.2 does not exist in actions/checkout',
      category: 'ref-missing',
      severity: 'error',
      workflow: CI_KEY,
    },
  ],
}

/**
 * Lockfile that tracks the CI workflow, pinning `actions/checkout@v3`.
 */
const CI_LOCKFILE = makeLockfileText({
  dependencies: { 'actions/checkout@v3': RECORDED_CHECKOUT_SHA },
  workflows: { [CI_KEY]: ['actions/checkout@v3'] },
})

/**
 * Lockfile of the CI workflow regenerated for the update of checkout.
 */
const RELOCKED_CI_LOCKFILE = makeLockfileText({
  dependencies: { [`actions/checkout@${CHECKOUT_SHA}`]: CHECKOUT_SHA },
  workflows: { [CI_KEY]: [`actions/checkout@${CHECKOUT_SHA}`] },
})

/**
 * Lockfile that tracks the CI and release workflows.
 */
const TWO_WORKFLOWS_LOCKFILE = makeLockfileText({
  dependencies: {
    'actions/setup-node@v3': RECORDED_CHECKOUT_SHA,
    'actions/checkout@v3': RECORDED_CHECKOUT_SHA,
  },
  workflows: {
    [RELEASE_KEY]: ['actions/setup-node@v3'],
    [CI_KEY]: ['actions/checkout@v3'],
  },
})

/**
 * Lockfile of the CI and release workflows once the CI workflow is relocked for
 * the update of checkout.
 */
const RELOCKED_TWO_WORKFLOWS_LOCKFILE = makeLockfileText({
  dependencies: {
    [`actions/checkout@${CHECKOUT_SHA}`]: CHECKOUT_SHA,
    'actions/setup-node@v3': RECORDED_CHECKOUT_SHA,
  },
  workflows: {
    [CI_KEY]: [`actions/checkout@${CHECKOUT_SHA}`],
    [RELEASE_KEY]: ['actions/setup-node@v3'],
  },
})

/**
 * Bytes of the byte order mark a UTF-8 file may start with.
 */
const BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * Step of the CI workflow once checkout is updated.
 */
const UPDATED_CHECKOUT = `actions/checkout@${CHECKOUT_SHA} # v4.2.2`

describe('lockfile flow', () => {
  let root: string
  let repository: string
  let stub: string

  let consoleInfoSpy: MockInstance<typeof console.info>
  let consoleErrorSpy: MockInstance<typeof console.error>
  let stderrWriteSpy: MockInstance<typeof process.stderr.write>

  /**
   * Write the files of the repository, each by its path from the root.
   *
   * @param files - Paths mapped to their text or bytes.
   */
  async function writeRepository(
    files: Record<string, string | Buffer>,
  ): Promise<void> {
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(dirname(join(repository, path)), { recursive: true })
        await writeFile(join(repository, path), content)
      }),
    )
  }

  /**
   * Read a file of the repository.
   *
   * @param path - Path from the root.
   * @returns The bytes of the file.
   */
  function readRepository(path: string): Promise<Buffer> {
    return readFile(join(repository, path))
  }

  /**
   * Tell the stand-in for `gh` what to do when it is run for a relock.
   *
   * @param behavior - What it does.
   */
  async function arrangeGh(behavior: GhBehavior): Promise<void> {
    let { writes = {}, status = 0, report, hold } = behavior
    await writeFile(join(stub, 'status'), `${status}\n`)
    if (report) {
      await writeFile(join(stub, 'report'), `${JSON.stringify(report)}\n`)
    }
    if (hold) {
      await writeFile(join(stub, 'hold'), '')
    }
    await Promise.all(
      Object.entries(writes).map(async ([path, content]) => {
        await mkdir(dirname(join(stub, 'writes', path)), { recursive: true })
        await writeFile(join(stub, 'writes', path), content)
      }),
    )
  }

  /**
   * Read how the stand-in for `gh` was run for each relock.
   *
   * @returns The calls in order.
   */
  async function readGhCalls(): Promise<GhCall[]> {
    let text: string
    try {
      text = await readFile(join(stub, 'calls'), 'utf8')
    } catch {
      return []
    }
    let calls: GhCall[] = []
    for (let line of text.split('\n')) {
      let space = line.indexOf(' ')
      let [kind, value] =
        space === -1 ?
          [line, '']
        : [line.slice(0, space), line.slice(space + 1)]
      let call = calls.at(-1)
      if (kind === 'call') {
        calls.push({ args: [], env: {}, cwd: '' })
      } else if (call && kind === 'cwd') {
        call.cwd = value
      } else if (call && kind === 'arg') {
        call.args.push(value)
      } else if (call && kind === 'env') {
        let equals = value.indexOf('=')
        call.env[value.slice(0, equals)] = value.slice(equals + 1)
      }
    }
    return calls
  }

  /**
   * Run the CLI and wait for it to finish.
   *
   * @param argv - Arguments passed after the executable name.
   */
  async function runCli(...argv: string[]): Promise<void> {
    process.argv = ['node', 'actions-up', ...argv]
    await run()
  }

  /**
   * Run the CLI while the stand-in for `gh` holds the relock, send it the given
   * signal once the relock started, and let the relock go on.
   *
   * @param signal - Signal the CLI gets.
   * @param argv - Arguments passed after the executable name.
   */
  async function runCliInterrupted(
    signal: NodeJS.Signals,
    ...argv: string[]
  ): Promise<void> {
    let running = runCli(...argv)
    await vi.waitFor(
      () => {
        expect(existsSync(join(stub, 'started'))).toBe(true)
      },
      { timeout: 10_000, interval: 20 },
    )
    process.emit(signal)
    await writeFile(join(stub, 'go'), '')
    await running
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
   * Lines the spinners wrote to standard error, without colors.
   *
   * @returns Written lines.
   */
  function spinnerLines(): string[] {
    return stripAnsi(
      stderrWriteSpy.mock.calls.map(([chunk]) => String(chunk)).join(''),
    )
      .split('\n')
      .filter(line => line !== '')
  }

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))

    root = await realpath(await mkdtemp(join(tmpdir(), 'actions-up-flow-')))
    repository = join(root, 'repo')
    stub = join(root, 'gh')
    await mkdir(join(repository, '.git'), { recursive: true })
    await mkdir(stub)
    await writeFile(join(stub, 'gh'), GH_STUB, { mode: 0o755 })
    await arrangeGh({})

    vi.stubEnv('PATH', `${stub}${delimiter}${process.env['PATH'] ?? ''}`)
    vi.stubEnv('GH_ACTIONS_LOCK_WORKFLOWS_DIR', undefined)
    vi.stubEnv('GH_ACTIONS_LOCK_REPO_ROOT', undefined)
    vi.stubEnv('GH_FORCE_TTY', undefined)
    vi.stubEnv('GITHUB_TOKEN', undefined)
    vi.spyOn(process, 'cwd').mockReturnValue(repository)

    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    vi.mocked(createGitHubClient).mockReturnValue(
      createMockClient({
        getBranchTipAt: vi
          .fn<GitHubClient['getBranchTipAt']>()
          .mockResolvedValue({
            sha: 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a',
            since: new Date(ON_BRANCH_SINCE),
          }),
        compareCommits: vi
          .fn<GitHubClient['compareCommits']>()
          .mockResolvedValue('behind'),
      }),
    )
    vi.mocked(checkUpdates).mockImplementation(actions =>
      Promise.resolve(actions.flatMap(action => makeUpdate(action))),
    )
  })

  afterEach(async () => {
    process.exitCode = undefined
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    await rm(root, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')(
    'writes an update of a tracked workflow and regenerates the lockfile for it from the root of the repository',
    async () => {
      await writeRepository({
        [`.github/workflows/ci.yml`]: makeWorkflowText(['actions/checkout@v3']),
        [LOCKFILE_KEY]: CI_LOCKFILE,
      })
      await arrangeGh({
        report: makeReport(['actions/checkout', CHECKOUT_SHA, CHECKOUT_SHA]),
        writes: { [LOCKFILE_KEY]: RELOCKED_CI_LOCKFILE },
      })

      await runCli('--yes')

      expect(String(await readRepository(CI_KEY))).toBe(
        makeWorkflowText([UPDATED_CHECKOUT]),
      )
      expect(String(await readRepository(LOCKFILE_KEY))).toBe(
        RELOCKED_CI_LOCKFILE,
      )
      await expect(readGhCalls()).resolves.toStrictEqual([
        {
          env: {
            GH_ACTIONS_LOCK_WORKFLOWS_DIR: join(
              repository,
              '.github/workflows',
            ),
            GH_ACTIONS_LOCK_REPO_ROOT: repository,
            GH_FORCE_TTY: '',
          },
          args: [...RELOCK_ARGUMENTS, CI_KEY],
          cwd: repository,
        },
      ])
      expect(spinnerLines()).toContain(`- Regenerating ${LOCKFILE_KEY}...`)
      expect(printedLines()).toStrictEqual([
        '🚀 Actions Up!',
        '🔄 Updating 1 entry...',
        '✓ Updates applied successfully!',
      ])
      expect(printedErrors()).toStrictEqual([])
      expect(process.exitCode).toBeUndefined()
    },
  )

  it.skipIf(process.platform === 'win32')(
    'puts back a workflow whose lockfile gh-actions-lock reports as regenerated but leaves as it was',
    async () => {
      let workflow = makeWorkflowText(['actions/checkout@v3'])
      await writeRepository({
        [LOCKFILE_KEY]: CI_LOCKFILE,
        [CI_KEY]: workflow,
      })
      await arrangeGh({
        report: makeReport(['actions/checkout', CHECKOUT_SHA, CHECKOUT_SHA]),
      })

      await runCli('--yes')

      expect(String(await readRepository(CI_KEY))).toBe(workflow)
      expect(String(await readRepository(LOCKFILE_KEY))).toBe(CI_LOCKFILE)
      expect(printedErrors()).toStrictEqual([
        `⚠️ gh actions-lock did not pin what Actions Up checked in ${LOCKFILE_KEY}`,
        `   • actions/checkout@${CHECKOUT_SHA} is not recorded for ${CI_KEY} in the lockfile on disk, though gh actions-lock reported it as pinned`,
        '   Restored 1 file to match the lockfile again:',
        `   • ${CI_KEY}`,
      ])
      expect(process.exitCode).toBe(1)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'puts back the bytes of a workflow whose lockfile gh-actions-lock did not regenerate, with its byte order mark, CRLF line breaks and text beyond ASCII',
    async () => {
      let workflow = Buffer.concat([
        BYTE_ORDER_MARK,
        Buffer.from(
          makeWorkflowText(['actions/checkout@v3 # café ✓'], '\r\n'),
          'utf8',
        ),
      ])
      await writeRepository({
        [LOCKFILE_KEY]: CI_LOCKFILE,
        [CI_KEY]: workflow,
      })
      await arrangeGh({ report: BLOCKED_REPORT, status: 1 })

      await runCli('--yes')

      await expect(readRepository(CI_KEY)).resolves.toStrictEqual(workflow)
      expect(String(await readRepository(LOCKFILE_KEY))).toBe(CI_LOCKFILE)
      expect(printedErrors()).toStrictEqual([
        `⚠️ gh actions-lock did not regenerate ${LOCKFILE_KEY}: it found problems that block the lockfile`,
        `   • ${CI_KEY}: ref v4.2.2 does not exist in actions/checkout (ref-missing)`,
        '   Restored 1 file to match the lockfile again:',
        `   • ${CI_KEY}`,
      ])
      expect(process.exitCode).toBe(1)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'writes and relocks only the workflow that runs no action of the repository through ./',
    async () => {
      let release = makeWorkflowText([
        './.github/actions/build',
        'actions/setup-node@v3',
      ])
      let build = [
        'name: Build',
        'description: Build steps',
        'runs:',
        '  using: composite',
        '  steps:',
        '    - uses: actions/cache@v3',
        '',
      ].join('\n')
      await writeRepository({
        [CI_KEY]: makeWorkflowText(['actions/checkout@v3']),
        '.github/actions/build/action.yml': build,
        [LOCKFILE_KEY]: TWO_WORKFLOWS_LOCKFILE,
        [RELEASE_KEY]: release,
      })
      await arrangeGh({
        report: makeReport(['actions/checkout', CHECKOUT_SHA, CHECKOUT_SHA]),
        writes: { [LOCKFILE_KEY]: RELOCKED_TWO_WORKFLOWS_LOCKFILE },
      })

      await runCli('--yes')

      expect(String(await readRepository(CI_KEY))).toBe(
        makeWorkflowText([UPDATED_CHECKOUT]),
      )
      expect(String(await readRepository(RELEASE_KEY))).toBe(release)
      expect(
        String(await readRepository('.github/actions/build/action.yml')),
      ).toBe(build)
      expect((await readGhCalls()).map(({ args }) => args)).toStrictEqual([
        [...RELOCK_ARGUMENTS, CI_KEY],
      ])
      expect(printedLines()).toContain(
        '⚠️  Skipped 2 actions in workflows that run actions through ./, or in the actions they run, which gh actions-lock does not lock (change ./ to $/ for an action of the repository; gh actions-lock --migrate-local-actions does it in workflows, not in action files)',
      )
      expect(process.exitCode).toBeUndefined()
    },
  )

  it.skipIf(process.platform === 'win32')(
    'relocks only for the locked updates that were written',
    async () => {
      let edited = makeWorkflowText(['actions/setup-node@v3.9.1'])
      await writeRepository({
        [RELEASE_KEY]: makeWorkflowText(['actions/setup-node@v3']),
        [CI_KEY]: makeWorkflowText(['actions/checkout@v3']),
        [LOCKFILE_KEY]: TWO_WORKFLOWS_LOCKFILE,
      })
      await arrangeGh({
        report: makeReport(['actions/checkout', CHECKOUT_SHA, CHECKOUT_SHA]),
        writes: { [LOCKFILE_KEY]: RELOCKED_TWO_WORKFLOWS_LOCKFILE },
      })

      /**
       * The release workflow changes once the scan read it, so its update is no
       * longer written.
       */
      vi.mocked(checkUpdates).mockImplementation(async actions => {
        await writeRepository({ [RELEASE_KEY]: edited })
        return actions.flatMap(action => makeUpdate(action))
      })

      await runCli('--yes')

      expect(String(await readRepository(CI_KEY))).toBe(
        makeWorkflowText([UPDATED_CHECKOUT]),
      )
      expect(String(await readRepository(RELEASE_KEY))).toBe(edited)
      expect((await readGhCalls()).map(({ args }) => args)).toStrictEqual([
        [...RELOCK_ARGUMENTS, CI_KEY],
      ])
      expect(printedErrors()).toStrictEqual([
        '⚠️ Could not write 1 of 2 entries:',
        `   • actions/setup-node@v3 (${join(repository, RELEASE_KEY)}:6)`,
      ])
      expect(process.exitCode).toBe(1)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'points gh-actions-lock at the lockfile and output meant for pipes whatever the environment says',
    async () => {
      vi.stubEnv(
        'GH_ACTIONS_LOCK_WORKFLOWS_DIR',
        '/elsewhere/.github/workflows',
      )
      vi.stubEnv('GH_FORCE_TTY', '100')
      await writeRepository({
        [CI_KEY]: makeWorkflowText(['actions/checkout@v3']),
        [LOCKFILE_KEY]: CI_LOCKFILE,
      })
      await arrangeGh({
        report: makeReport(['actions/checkout', CHECKOUT_SHA, CHECKOUT_SHA]),
        writes: { [LOCKFILE_KEY]: RELOCKED_CI_LOCKFILE },
      })

      await runCli('--yes')

      await expect(readGhCalls()).resolves.toStrictEqual([
        expect.objectContaining({
          env: {
            GH_ACTIONS_LOCK_WORKFLOWS_DIR: join(
              repository,
              '.github/workflows',
            ),
            GH_ACTIONS_LOCK_REPO_ROOT: repository,
            GH_FORCE_TTY: '',
          },
        }),
      ])
      expect(process.exitCode).toBeUndefined()
    },
  )

  it.skipIf(process.platform === 'win32')(
    'puts nothing back when a signal arrives while gh-actions-lock fails, and ends with the code of the signal',
    async () => {
      let listeners = process.listeners('SIGINT')
      await writeRepository({
        [CI_KEY]: makeWorkflowText(['actions/checkout@v3']),
        [LOCKFILE_KEY]: CI_LOCKFILE,
      })
      await arrangeGh({ report: BLOCKED_REPORT, hold: true, status: 1 })

      await runCliInterrupted('SIGINT', '--yes')

      expect(String(await readRepository(CI_KEY))).toBe(
        makeWorkflowText([UPDATED_CHECKOUT]),
      )
      expect(String(await readRepository(LOCKFILE_KEY))).toBe(CI_LOCKFILE)
      expect(printedErrors()).toStrictEqual([
        `⚠️ gh actions-lock did not regenerate ${LOCKFILE_KEY}: it found problems that block the lockfile`,
        `   • ${CI_KEY}: ref v4.2.2 does not exist in actions/checkout (ref-missing)`,
        '   Kept the updates in 1 file; run this to regenerate the lockfile:',
        `   • ${CI_KEY}`,
        `   GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR="$PWD/.github/workflows" gh actions-lock --no-onboard --no-narrow -- ${CI_KEY}`,
        '⚠️ Interrupted by SIGINT',
      ])
      expect(process.exitCode).toBe(130)
      await vi.waitFor(() => {
        expect(process.listeners('SIGINT')).toStrictEqual(listeners)
      })
    },
    20_000,
  )

  it.skipIf(process.platform === 'win32')(
    'ends with the code of a signal that arrives while gh-actions-lock regenerates the lockfile as checked',
    async () => {
      let listeners = process.listeners('SIGTERM')
      await writeRepository({
        [CI_KEY]: makeWorkflowText(['actions/checkout@v3']),
        [LOCKFILE_KEY]: CI_LOCKFILE,
      })
      await arrangeGh({
        report: makeReport(['actions/checkout', CHECKOUT_SHA, CHECKOUT_SHA]),
        writes: { [LOCKFILE_KEY]: RELOCKED_CI_LOCKFILE },
        hold: true,
      })

      await runCliInterrupted('SIGTERM', '--yes')

      expect(String(await readRepository(CI_KEY))).toBe(
        makeWorkflowText([UPDATED_CHECKOUT]),
      )
      expect(String(await readRepository(LOCKFILE_KEY))).toBe(
        RELOCKED_CI_LOCKFILE,
      )
      expect(printedLines().at(-1)).toBe('✓ 1 of 1 entry applied')
      expect(printedErrors()).toStrictEqual(['⚠️ Interrupted by SIGTERM'])
      expect(process.exitCode).toBe(143)
      await vi.waitFor(() => {
        expect(process.listeners('SIGTERM')).toStrictEqual(listeners)
      })
    },
    20_000,
  )
})
