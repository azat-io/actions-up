import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { makeWorkflowLockfile } from '../helpers/make-workflow-lockfile'
import { printSkippedWarning } from '../../cli/print-skipped-warning'
import { spyOnConsoleInfo } from '../helpers/spy-on-console-info'

/**
 * Reference and skip reason of a skipped update.
 */
interface SkippedOptions {
  /**
   * Why the update check skipped the reference.
   */
  skipReason?: SkippedUpdate['skipReason']

  /**
   * Reference the update would have written.
   */
  targetRef?: string

  /**
   * Version the reference is pinned to.
   */
  version?: string

  /**
   * File the reference is written in.
   */
  file?: string

  /**
   * Action name.
   */
  name?: string
}

/**
 * Skipped entry in the shape the CLI hands to the printer.
 */
type SkippedUpdate = Parameters<typeof printSkippedWarning>[0][number]

/**
 * Create a skipped update the way the update check reports it.
 *
 * @param options - Reference and skip reason; a branch-pinned
 *   `actions/checkout@main` by default.
 * @returns Fresh skipped update.
 */
function makeSkipped({
  name = 'actions/checkout',
  skipReason = 'branch',
  version = 'main',
  targetRef,
  file,
}: SkippedOptions = {}): SkippedUpdate {
  return {
    action: { version, name, file },
    currentVersion: version,
    skipReason,
    targetRef,
  }
}

/**
 * Path of the CI workflow of `/repo`.
 */
const CI_WORKFLOW = '/repo/.github/workflows/ci.yml'

/**
 * What follows the entries whose update would move the workflow back, up to the
 * command that moves the pin forward.
 */
const MOVE_PIN =
  '   This moves the pin forward for every workflow that uses it, along with each other reference of these workflows that moved, without the cool-down and trust checks:'

/**
 * Start of the command that moves a pin of the lockfile of `/repo` forward, up
 * to the workflows it names.
 */
const RELOCK_COMMAND =
  '   GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows gh actions-lock --no-onboard --no-narrow --relock --'

describe('printSkippedWarning', () => {
  let consoleInfoSpy = spyOnConsoleInfo()

  it.each([
    {
      expectedText:
        '\n⚠️  Skipped 1 action pinned to branches (use --include-branches to check them)\n' +
        '   • actions/checkout@main',
      hint: 'with the --include-branches hint when branches are not checked',
      skipped: [makeSkipped()],
      includeBranches: false,
      count: 'one action',
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action pinned to branches\n' +
        '   • actions/checkout@main',
      hint: 'without the hint when branches are checked',
      skipped: [makeSkipped()],
      includeBranches: true,
      count: 'one action',
    },
    {
      expectedText:
        '\n⚠️  Skipped 2 actions pinned to branches (use --include-branches to check them)\n' +
        '   • actions/checkout@main\n' +
        '   • actions/setup-node@main',
      hint: 'with the --include-branches hint when branches are not checked',
      skipped: [makeSkipped(), makeSkipped({ name: 'actions/setup-node' })],
      count: 'several actions',
      includeBranches: false,
    },
    {
      expectedText:
        '\n⚠️  Skipped 2 actions pinned to branches\n' +
        '   • actions/checkout@main\n' +
        '   • actions/setup-node@main',
      skipped: [makeSkipped(), makeSkipped({ name: 'actions/setup-node' })],
      hint: 'without the hint when branches are checked',
      count: 'several actions',
      includeBranches: true,
    },
  ])(
    'reports $count pinned to branches $hint',
    ({ includeBranches, expectedText, skipped }) => {
      printSkippedWarning(skipped, { includeBranches, style: 'sha' })

      expect(consoleInfoSpy.printedText()).toBe(expectedText)
    },
  )

  it.each([
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose current ref style could not be preserved\n' +
        '   • actions/cache@v3',
      skipped: makeSkipped({
        skipReason: 'unsupported-style',
        name: 'actions/cache',
        version: 'v3',
      }),
      description: 'refs whose current style cannot be preserved',
      style: 'preserve' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action that could not be updated with the current style\n' +
        '   • actions/cache@v3',
      skipped: makeSkipped({
        skipReason: 'unsupported-style',
        name: 'actions/cache',
        version: 'v3',
      }),
      description: 'refs the current style cannot update',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose tag family differs from the latest release (check them manually)\n' +
        '   • christopher-buss/bedrock/packages/actions/deploy@actions-v0.1.1',
      skipped: makeSkipped({
        name: 'christopher-buss/bedrock/packages/actions/deploy',
        version: 'actions-v0.1.1',
        skipReason: 'tag-family',
      }),
      description: 'tag family mismatches',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action that cannot be compared with the latest tag as versions (check them manually)\n' +
        '   • docker/login-action@latest',
      skipped: makeSkipped({
        skipReason: 'not-comparable',
        name: 'docker/login-action',
        version: 'latest',
      }),
      description: 'references that cannot be compared as versions',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose repository was not found (private repositories need a GITHUB_TOKEN with access)\n' +
        '   • my-org/internal-action@v1',
      skipped: makeSkipped({
        name: 'my-org/internal-action',
        skipReason: 'not-found',
        version: 'v1',
      }),
      description: 'actions whose repository was not found',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose reference type could not be resolved (GitHub API request failed)\n' +
        '   • actions/upload-artifact@v4',
      skipped: makeSkipped({
        skipReason: 'ref-type-unavailable',
        name: 'actions/upload-artifact',
        version: 'v4',
      }),
      description: 'references whose type could not be resolved',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose update check failed (see warnings above)\n' +
        '   • actions/setup-go@v5',
      skipped: makeSkipped({
        skipReason: 'check-failed',
        name: 'actions/setup-go',
        version: 'v5',
      }),
      description: 'failed update checks',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose tag could not be resolved to a commit (missing tag or failed GitHub API request)\n' +
        '   • actions/setup-go@v5',
      skipped: makeSkipped({
        skipReason: 'sha-unresolved',
        name: 'actions/setup-go',
        version: 'v5',
      }),
      description: 'tags that could not be resolved to a commit',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose commit could not be checked against the repository history (failed GitHub API request or too many protected branches)\n' +
        '   • actions/setup-go@v5',
      skipped: makeSkipped({
        skipReason: 'reachability-unknown',
        name: 'actions/setup-go',
        version: 'v5',
      }),
      description: 'commits that could not be checked against the history',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action whose tag now points at another commit than the pin and whose release could not be read (failed GitHub API request)\n' +
        '   • actions/setup-go@v5',
      skipped: makeSkipped({
        skipReason: 'release-unresolved',
        name: 'actions/setup-go',
        version: 'v5',
      }),
      description: 'moved pins whose release could not be read',
      style: 'sha' as const,
    },
    {
      skipped: makeSkipped({
        name: 'actions/checkout',
        skipReason: 'lockfile',
        version: 'v4',
      }),
      expectedText:
        '\n⚠️  Skipped 1 action pinned by a workflow lockfile\n' +
        '   • actions/checkout@v4',
      description: 'references a lockfile pins',
      style: 'sha' as const,
    },
    {
      expectedText:
        '\n⚠️  Skipped 1 action pinned by a workflow lockfile to a commit that was not compared with the latest version (gh actions-lock --relock moves such pins forward)\n' +
        '   • actions/checkout@v4',
      skipped: makeSkipped({
        skipReason: 'lockfile-unchecked',
        name: 'actions/checkout',
        version: 'v4',
      }),
      description: 'tags whose commit a workflow lockfile pins unchecked',
      style: 'semver' as const,
    },
  ])(
    'reports $description under a dedicated header',
    ({ expectedText, skipped, style }) => {
      printSkippedWarning([skipped], { includeBranches: false, style })

      expect(consoleInfoSpy.printedText()).toBe(expectedText)
    },
  )

  it.each([
    [
      'missing',
      'run gh extension install github/gh-actions-lock to update them',
    ] as const,
    [
      'outdated',
      'run gh extension upgrade gh-actions-lock --force to update them; v0.5.0 or later is needed',
    ] as const,
    [
      'no-gh',
      'install the GitHub CLI from https://cli.github.com and run gh extension install github/gh-actions-lock to update them',
    ] as const,
    [
      'unlisted',
      'gh could not list its extensions, so gh-actions-lock was not looked for',
    ] as const,
    [
      'unauthenticated',
      'run gh auth login or set GH_TOKEN, so that gh can run gh-actions-lock, to update them',
    ] as const,
  ])(
    'says how to get gh-actions-lock for references a lockfile pins when it is %s',
    (lockTool, hint) => {
      printSkippedWarning(
        [makeSkipped({ skipReason: 'lockfile', version: 'v4' })],
        { includeBranches: false, style: 'sha', lockTool },
      )

      expect(consoleInfoSpy.printedText()).toBe(
        `\n⚠️  Skipped 1 action pinned by a workflow lockfile (${hint})\n` +
          '   • actions/checkout@v4',
      )
    },
  )

  it('tells apart references whose lockfiles cannot be regenerated anyway, and why', () => {
    printSkippedWarning(
      [
        makeSkipped({
          file: '/repo/.github/actions/local/action.yml',
          name: 'actions/setup-node',
          skipReason: 'lockfile',
          version: 'v4',
        }),
        makeSkipped({
          file: '/repo/vendor/.github/workflows/ci.yml',
          skipReason: 'lockfile',
          version: 'v4',
        }),
        makeSkipped({
          file: '/repo/.github/actions/broken/action.yml',
          skipReason: 'lockfile',
          name: 'actions/cache',
          version: 'v4',
        }),
        makeSkipped({
          file: '/repo/.github/workflows/ci.yml',
          name: 'actions/upload-artifact',
          skipReason: 'lockfile',
          version: 'v4',
        }),
      ],
      {
        relockBlockers: new Map([
          ['/repo/.github/actions/broken/action.yml', 'unreadable'],
          ['/repo/.github/actions/local/action.yml', 'unrecorded'],
          ['/repo/vendor/.github/workflows/ci.yml', 'shared'],
        ]),
        includeBranches: false,
        lockTool: 'missing',
        style: 'sha',
      },
    )

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⚠️  Skipped 1 action pinned by a workflow lockfile (run gh extension install github/gh-actions-lock to update them)\n' +
        '   • actions/upload-artifact@v4\n' +
        '\n⚠️  Skipped 1 action pinned by a workflow lockfile that cannot be regenerated for them, since it, a workflow it tracks or an action of the repository cannot be read\n' +
        '   • actions/cache@v4\n' +
        '\n⚠️  Skipped 1 action in workflows that run actions through ./ or composite actions whose runs.using is not in lower case, or in the actions they run, which gh actions-lock does not lock (for an action of the repository change ./ to $/, which gh actions-lock --migrate-local-actions does in workflows, not in action files; write runs.using: composite in lower case; an action that is checked out while the workflow runs cannot be locked)\n' +
        '   • actions/setup-node@v4\n' +
        '\n⚠️  Skipped 1 action pinned by the workflow lockfiles of more than one repository root, which Actions Up does not regenerate together\n' +
        '   • actions/checkout@v4',
    )
  })

  describe('with updates that would move their workflows back', () => {
    /**
     * Lockfile of `/repo` that pins `v4` of checkout for the release and deploy
     * workflows, and `v4` of cache for the release workflow alone.
     */
    let lockfile = makeWorkflowLockfile({
      pins: new Map([
        [
          '.github/workflows/release.yml',
          ['actions/checkout@v4', 'actions/cache@v4'],
        ],
        ['.github/workflows/ci.yml', ['actions/checkout@v4.2.2']],
        ['.github/workflows/deploy.yml', ['actions/checkout@v4']],
      ]),
    })

    beforeEach(() => {
      vi.spyOn(process, 'cwd').mockReturnValue('/repo')
    })

    afterEach(() => {
      vi.mocked(process.cwd).mockRestore()
    })

    it('names the reference each would write, with the command that moves its pin forward for the workflows the lockfile pins it for', () => {
      printSkippedWarning(
        [
          makeSkipped({
            skipReason: 'lockfile-kept',
            file: CI_WORKFLOW,
            version: 'v4.2.2',
            targetRef: 'v4',
          }),
          makeSkipped({
            skipReason: 'lockfile-kept',
            name: 'actions/cache',
            file: CI_WORKFLOW,
            version: 'v4.2.3',
            targetRef: 'v4',
          }),
          makeSkipped({
            file: '/repo/.github/workflows/release.yml',
            skipReason: 'lockfile-kept',
            version: 'v4.2.2',
            targetRef: 'v4',
          }),
        ],
        {
          lockfiles: new Map([
            ['/repo/.github/workflows/release.yml', lockfile],
            [CI_WORKFLOW, lockfile],
          ]),
          includeBranches: false,
          style: 'semver',
        },
      )

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action whose update would move the workflow back: the workflow lockfile pins actions/checkout@v4, the reference it writes, at an older commit for other workflows\n' +
          '   • actions/checkout@v4.2.2 (×2)\n' +
          `${MOVE_PIN}\n` +
          `${RELOCK_COMMAND} .github/workflows/deploy.yml .github/workflows/release.yml\n` +
          '\n⚠️  Skipped 1 action whose update would move the workflow back: the workflow lockfile pins actions/cache@v4, the reference it writes, at an older commit for other workflows\n' +
          '   • actions/cache@v4.2.3\n' +
          `${MOVE_PIN}\n` +
          `${RELOCK_COMMAND} .github/workflows/release.yml`,
      )
    })

    it('names the root of a nested repository from the working directory, and the reference without the path of its action', () => {
      let workflow = '/repo/vendor/tool/.github/workflows/ci.yml'

      printSkippedWarning(
        [
          makeSkipped({
            name: 'GitHub/CodeQL-Action/init',
            skipReason: 'lockfile-kept',
            version: 'v3.28.0',
            targetRef: 'v3',
            file: workflow,
          }),
        ],
        {
          lockfiles: new Map([
            [
              workflow,
              makeWorkflowLockfile({
                pins: new Map([
                  [
                    '.github/workflows/release.yml',
                    ['github/codeql-action@v3'],
                  ],
                ]),
                path: '/repo/vendor/tool/.github/workflows/actions.lock',
                root: '/repo/vendor/tool',
              }),
            ],
          ]),
          includeBranches: false,
          style: 'semver',
        },
      )

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action whose update would move the workflow back: the workflow lockfile pins GitHub/CodeQL-Action@v3, the reference it writes, at an older commit for other workflows\n' +
          '   • GitHub/CodeQL-Action/init@v3.28.0\n' +
          `${MOVE_PIN}\n` +
          '   (cd -P ./vendor/tool && GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows gh actions-lock --no-onboard --no-narrow --relock -- .github/workflows/release.yml)',
      )
    })

    it('gives no command for a reference the lockfile pins for no workflow', () => {
      printSkippedWarning(
        [
          makeSkipped({
            skipReason: 'lockfile-kept',
            name: 'actions/setup-node',
            file: CI_WORKFLOW,
            version: 'v4.4.0',
            targetRef: 'v4',
          }),
        ],
        {
          lockfiles: new Map([[CI_WORKFLOW, lockfile]]),
          includeBranches: false,
          style: 'semver',
        },
      )

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action whose update would move the workflow back: the workflow lockfile pins actions/setup-node@v4, the reference it writes, at an older commit for other workflows\n' +
          '   • actions/setup-node@v4.4.0',
      )
    })

    it('lists them after the references whose lockfiles cannot be regenerated, and before the tags whose pin was not compared', () => {
      printSkippedWarning(
        [
          makeSkipped({ skipReason: 'lockfile-unchecked', version: 'v4' }),
          makeSkipped({
            skipReason: 'lockfile-kept',
            file: CI_WORKFLOW,
            version: 'v4.2.2',
            targetRef: 'v4',
          }),
          makeSkipped({
            name: 'actions/upload-artifact',
            skipReason: 'lockfile',
            version: 'v3',
          }),
        ],
        {
          lockfiles: new Map([[CI_WORKFLOW, lockfile]]),
          includeBranches: false,
          style: 'semver',
        },
      )

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action pinned by a workflow lockfile\n' +
          '   • actions/upload-artifact@v3\n' +
          '\n⚠️  Skipped 1 action whose update would move the workflow back: the workflow lockfile pins actions/checkout@v4, the reference it writes, at an older commit for other workflows\n' +
          '   • actions/checkout@v4.2.2\n' +
          `${MOVE_PIN}\n` +
          `${RELOCK_COMMAND} .github/workflows/deploy.yml .github/workflows/release.yml\n` +
          '\n⚠️  Skipped 1 action pinned by a workflow lockfile to a commit that was not compared with the latest version (gh actions-lock --relock moves such pins forward)\n' +
          '   • actions/checkout@v4',
      )
    })
  })

  it('lists each skipped action once with the number of places it appears in', () => {
    let skipped = [
      makeSkipped(),
      makeSkipped({ name: 'actions/setup-node' }),
      makeSkipped(),
    ]

    printSkippedWarning(skipped, { includeBranches: false, style: 'sha' })

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⚠️  Skipped 2 actions pinned to branches (use --include-branches to check them)\n' +
        '   • actions/checkout@main (×2)\n' +
        '   • actions/setup-node@main',
    )
  })

  it('groups entries by skip reason and prints the groups in a fixed order', () => {
    let skipped = [
      makeSkipped({
        skipReason: 'check-failed',
        name: 'actions/setup-go',
        version: 'v5',
      }),
      makeSkipped({
        skipReason: 'ref-type-unavailable',
        name: 'actions/upload-artifact',
        version: 'v4',
      }),
      makeSkipped({
        name: 'my-org/internal-action',
        skipReason: 'not-found',
        version: 'v1',
      }),
      makeSkipped({
        skipReason: 'not-comparable',
        name: 'docker/login-action',
        version: 'latest',
      }),
      makeSkipped({
        name: 'christopher-buss/bedrock/packages/actions/deploy',
        version: 'actions-v0.1.1',
        skipReason: 'tag-family',
      }),
      makeSkipped({
        skipReason: 'unsupported-style',
        name: 'actions/cache',
        version: 'v3',
      }),
      makeSkipped(),
    ]

    printSkippedWarning(skipped, { includeBranches: false, style: 'sha' })

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⚠️  Skipped 1 action pinned to branches (use --include-branches to check them)\n' +
        '   • actions/checkout@main\n' +
        '\n⚠️  Skipped 1 action that could not be updated with the current style\n' +
        '   • actions/cache@v3\n' +
        '\n⚠️  Skipped 1 action whose tag family differs from the latest release (check them manually)\n' +
        '   • christopher-buss/bedrock/packages/actions/deploy@actions-v0.1.1\n' +
        '\n⚠️  Skipped 1 action that cannot be compared with the latest tag as versions (check them manually)\n' +
        '   • docker/login-action@latest\n' +
        '\n⚠️  Skipped 1 action whose repository was not found (private repositories need a GITHUB_TOKEN with access)\n' +
        '   • my-org/internal-action@v1\n' +
        '\n⚠️  Skipped 1 action whose reference type could not be resolved (GitHub API request failed)\n' +
        '   • actions/upload-artifact@v4\n' +
        '\n⚠️  Skipped 1 action whose update check failed (see warnings above)\n' +
        '   • actions/setup-go@v5',
    )
  })

  describe('current behavior pending owner decision', () => {
    it('lists an entry without a skip reason among the branch-pinned actions', () => {
      let skipped = [
        {
          action: { name: 'actions/cache', version: 'v4' },
          currentVersion: 'v4',
        },
      ]

      printSkippedWarning(skipped, { includeBranches: false, style: 'sha' })

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action pinned to branches (use --include-branches to check them)\n' +
          '   • actions/cache@v4',
      )
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    /**
     * No producer emits `unknown`: the update check reports
     * ref-type-unavailable, check-failed, not-found, tag-family, branch and
     * not-comparable, and the CLI adds unsupported-style. The generic group
     * exists so that a reason added later still reaches the user instead of
     * disappearing.
     */
    it('reports a skip reason without a wording of its own under a generic header', () => {
      let skipped = [
        makeSkipped({
          name: 'actions/setup-python',
          skipReason: 'unknown',
          version: 'stable',
        }),
      ]

      printSkippedWarning(skipped, { includeBranches: false, style: 'sha' })

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action that could not be checked\n' +
          '   • actions/setup-python@stable',
      )
    })
  })
})
