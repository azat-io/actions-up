import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatRelockCommand,
  relockWorkflows,
} from '../../../core/lockfile/relock-workflows'
import { makeWorkflowLockfile } from '../../helpers/make-workflow-lockfile'
import { makeGhResult } from '../../helpers/make-gh-result'
import { runGh } from '../../../core/lockfile/run-gh'

vi.mock(import('../../../core/lockfile/run-gh'))

/**
 * Output of gh-actions-lock v0.4.1 for a run that regenerated the lockfile,
 * with a pin the tool reports in capitals, references it refused to pin, and
 * entries that are no pins or no refusals of a reference.
 */
const RELOCKED_OUTPUT = `{
  "cli_version": "v0.4.1",
  "findings": [
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "onboarding-required",
      "severity": "info",
      "confidence": "high",
      "dependency": "actions/upload-artifact@v4",
      "detail": "actions/upload-artifact@v4 has no lockfile entry; --no-onboard refuses to add new workflows or actions",
      "doc_url": "https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md#onboarding-required"
    },
    {
      "workflow": ".github/workflows/release.yml",
      "category": "onboarding-required",
      "severity": "info",
      "dependency": "GitHub/CodeQL-Action/init@v4",
      "detail": "GitHub/CodeQL-Action/init@v4 has no lockfile entry; --no-onboard refuses to add new workflows or actions"
    },
    {
      "workflow": ".github/workflows/docs.yml",
      "category": "onboarding-required",
      "severity": "info",
      "detail": "workflow has no lockfile entry; --no-onboard refuses to add new workflows or actions"
    },
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "sha-as-ref",
      "severity": "warning",
      "dependency": "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
      "detail": "pinned to a bare SHA without a symbolic ref"
    },
    { "category": "onboarding-required", "dependency": "actions/cache@v4" },
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "onboarding-required",
      "dependency": "checkout@v4"
    },
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "onboarding-required",
      "dependency": "actions/checkout"
    }
  ],
  "lockfile_version": "v0.0.3",
  "pins": [
    {
      "hostname": "github.com",
      "nwo": "actions/cache",
      "ref": "v4",
      "sha": "0057852bfaa89a56745cba8c7296529d2fc39830",
      "outcome": "verified"
    },
    {
      "hostname": "github.com",
      "nwo": "Actions/Setup-Node",
      "ref": "v5",
      "sha": "A0853C24544627F65DDF259ABE73B1D18A591444",
      "outcome": "pinned"
    },
    { "nwo": "actions/checkout", "ref": "v4" },
    "not a pin"
  ]
}`

/**
 * Output of gh-actions-lock v0.4.1 for a reference that does not exist, with a
 * warning about another pin of the same workflow.
 */
const BLOCKED_OUTPUT = `{
  "cli_version": "v0.4.1",
  "findings": [
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "sha-as-ref",
      "severity": "warning",
      "dependency": "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
      "detail": "pinned to a bare SHA without a symbolic ref",
      "doc_url": "https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md#sha-as-ref"
    },
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "ref-missing",
      "severity": "error",
      "dependency": "actions/setup-node@v999",
      "detail": "ref v999 does not exist in actions/setup-node",
      "doc_url": "https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md#ref-missing"
    },
    {
      "workflow": ".github/workflows/release.yml",
      "category": "not-pinned",
      "detail": "workflow has no lockfile entry"
    },
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "ref-changed",
      "severity": "error",
      "dependency": "actions/checkout@v5",
      "detail": "workflow uses ref v5, but the lockfile pins v4"
    },
    {
      "workflow": ".github/workflows/ci.yml",
      "category": "stale",
      "severity": "error",
      "dependency": "actions/checkout@v4",
      "detail": "lockfile pins actions/checkout@v4, which the workflow no longer uses"
    },
    { "severity": "error", "category": "stale" },
    { "severity": "error", "detail": "lockfile cannot be written" },
    { "workflow": ".github/workflows/ci.yml", "category": "invalid-workflow" },
    "not a finding"
  ],
  "lockfile_version": "v0.0.3"
}`

describe('relockWorkflows', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('relocks the workflows by their keys from the repository root and reads what the lockfile pins and what it was refused', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ stdout: RELOCKED_OUTPUT }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), [
        '.github/workflows/ci.yml',
        '.github/workflows/release.yml',
      ]),
    ).resolves.toStrictEqual({
      pins: [
        {
          sha: '0057852bfaa89a56745cba8c7296529d2fc39830',
          repository: 'actions/cache',
          ref: 'v4',
        },
        {
          sha: 'a0853c24544627f65ddf259abe73b1d18a591444',
          repository: 'actions/setup-node',
          ref: 'v5',
        },
      ],
      refusals: [
        {
          repository: 'actions/upload-artifact',
          workflow: '.github/workflows/ci.yml',
          ref: 'v4',
        },
        {
          workflow: '.github/workflows/release.yml',
          repository: 'github/codeql-action',
          ref: 'v4',
        },
      ],
      kind: 'relocked',
    })
    expect(runGh).toHaveBeenCalledExactlyOnceWith(
      [
        'actions-lock',
        '--no-onboard',
        '--no-narrow',
        '--no-interactive',
        '--json=findings,pins',
        '--',
        '.github/workflows/ci.yml',
        '.github/workflows/release.yml',
      ],
      {
        env: {
          GH_ACTIONS_LOCK_WORKFLOWS_DIR: '/repo/.github/workflows',
          GH_ACTIONS_LOCK_REPO_ROOT: '/repo',
        },
        cwd: '/repo',
      },
    )
  })

  it.each([
    ['output that is no JSON', 'Scanning 1 workflow'],
    ['JSON without pins', '{"findings":[]}'],
    ['JSON that is no object', '[]'],
  ])('reads no pins or refusals from %s', async (_description, stdout) => {
    vi.mocked(runGh).mockResolvedValue(makeGhResult({ stdout }))

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({ kind: 'relocked', refusals: [], pins: [] })
  })

  it('reports a run that a signal ended as stopped', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ signal: 'SIGINT', exitCode: null }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({ signal: 'SIGINT', kind: 'stopped' })
  })

  it('reports the findings that block the lockfile, leaving out warnings and what the relock fixes on its own', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ stdout: BLOCKED_OUTPUT, exitCode: 1 }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      findings: [
        {
          docUrl:
            'https://github.com/github/gh-actions-lock/blob/main/docs/troubleshooting.md#ref-missing',
          detail: 'ref v999 does not exist in actions/setup-node',
          workflow: '.github/workflows/ci.yml',
          category: 'ref-missing',
        },
        {
          detail: 'lockfile cannot be written',
          category: '',
          docUrl: null,
          workflow: '',
        },
        {
          workflow: '.github/workflows/ci.yml',
          category: 'invalid-workflow',
          detail: 'invalid-workflow',
          docUrl: null,
        },
      ],
      reason: 'it found problems that block the lockfile',
      kind: 'failed',
    })
  })

  it('leaves out what the relock fixes on its own even when nothing else blocks, since it would blame the update', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({
        stdout: JSON.stringify({
          findings: [
            {
              detail: 'workflow uses ref "v5" but lockfile pins "v4"',
              workflow: '.github/workflows/ci.yml',
              category: 'ref-changed',
              severity: 'error',
            },
          ],
        }),
        stderr: 'Scanning 1 workflow\nPlanning pins\n',
        exitCode: 1,
      }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason: 'it found problems that block the lockfile',
      kind: 'failed',
      findings: [],
    })
  })

  it('blames the tool failure, not what the relock fixes on its own, when gh fails after printing the lockfile as it was', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({
        stdout: JSON.stringify({
          findings: [
            {
              detail: 'workflow uses ref v5, but the lockfile pins v4',
              workflow: '.github/workflows/ci.yml',
              category: 'ref-changed',
              severity: 'error',
            },
          ],
        }),
        stderr:
          'planning pins: cannot rewrite actions/old-name during a partial workflow scan\n',
        exitCode: 2,
      }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason:
        'planning pins: cannot rewrite actions/old-name during a partial workflow scan',
      kind: 'failed',
      findings: [],
    })
  })

  it('reports a blocked run as blocked, not by the progress gh wrote to standard error', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({
        stderr: 'Scanning 1 workflow\nPlanning pins\n',
        stdout: '{"findings":[],"pins":[]}',
        exitCode: 1,
      }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason: 'it found problems that block the lockfile',
      kind: 'failed',
      findings: [],
    })
  })

  it('reports why gh failed for itself with exit code 1, without findings', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({
        stderr:
          'failed to run extension: fork/exec /home/me/.local/share/gh/extensions/gh-actions-lock/gh-actions-lock: exec format error\n',
        exitCode: 1,
      }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason:
        'failed to run extension: fork/exec /home/me/.local/share/gh/extensions/gh-actions-lock/gh-actions-lock: exec format error',
      kind: 'failed',
      findings: [],
    })
  })

  it('reports the last message of a tool failure', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({
        stderr:
          'Scanning 1 workflow\nopening lockfile: lockfile version v0.0.9 is newer than supported\n\n',
        stdout: 'not JSON',
        exitCode: 2,
      }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason:
        'opening lockfile: lockfile version v0.0.9 is newer than supported',
      kind: 'failed',
      findings: [],
    })
  })

  it('reports the exit code of a failure that printed nothing', async () => {
    vi.mocked(runGh).mockResolvedValue(makeGhResult({ exitCode: 2 }))

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason: 'it exited with code 2',
      kind: 'failed',
      findings: [],
    })
  })

  it('reports that gh could not be started', async () => {
    vi.mocked(runGh).mockResolvedValue(
      makeGhResult({ exitCode: null, started: false }),
    )

    await expect(
      relockWorkflows(makeWorkflowLockfile(), ['.github/workflows/ci.yml']),
    ).resolves.toStrictEqual({
      reason: 'gh could not be started',
      kind: 'failed',
      findings: [],
    })
  })
})

describe('formatRelockCommand', () => {
  it('writes the relock command with the root of the repository and the keys of the workflows after --', () => {
    expect(
      formatRelockCommand(
        ['.github/workflows/ci.yml', '.github/workflows/release.yml'],
        '',
      ),
    ).toBe(
      'GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR="$PWD/.github/workflows" gh actions-lock --no-onboard --no-narrow -- .github/workflows/ci.yml .github/workflows/release.yml',
    )
  })

  it('quotes a path a shell would split', () => {
    expect(formatRelockCommand([".github/workflows/it's ci.yml"], '')).toBe(
      String.raw`GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR="$PWD/.github/workflows" gh actions-lock --no-onboard --no-narrow -- '.github/workflows/it'\''s ci.yml'`,
    )
  })

  it('changes to the root of another repository and names it the root', () => {
    expect(
      formatRelockCommand(['.github/workflows/ci.yml'], 'vendor/my tool'),
    ).toBe(
      `(cd -P './vendor/my tool' && GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR="$PWD/.github/workflows" gh actions-lock --no-onboard --no-narrow -- .github/workflows/ci.yml)`,
    )
  })

  it.each([
    [
      'starts with a dash, which cd would read as an option',
      '-tool',
      './-tool',
    ],
    ['is a plain name, which cd would look up in CDPATH', 'tool', './tool'],
    [
      'leaves the working directory, which cd would leave through a symbolic link it entered by',
      '../tool',
      '../tool',
    ],
    ['is the parent directory', '..', '..'],
  ])(
    'changes to a root that %s through a path cd takes as it is',
    (_description, directory, path) => {
      expect(formatRelockCommand(['.github/workflows/ci.yml'], directory)).toBe(
        `(cd -P ${path} && GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR="$PWD/.github/workflows" gh actions-lock --no-onboard --no-narrow -- .github/workflows/ci.yml)`,
      )
    },
  )
})
