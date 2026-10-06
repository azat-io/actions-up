import { describe, expect, it } from 'vitest'

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
   * Version the reference is pinned to.
   */
  version?: string

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
}: SkippedOptions = {}): SkippedUpdate {
  return { action: { version, name }, currentVersion: version, skipReason }
}

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
      printSkippedWarning(skipped, includeBranches, 'sha')

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
  ])(
    'reports $description under a dedicated header',
    ({ expectedText, skipped, style }) => {
      printSkippedWarning([skipped], false, style)

      expect(consoleInfoSpy.printedText()).toBe(expectedText)
    },
  )

  it('lists each skipped action once with the number of places it appears in', () => {
    let skipped = [
      makeSkipped(),
      makeSkipped({ name: 'actions/setup-node' }),
      makeSkipped(),
    ]

    printSkippedWarning(skipped, false, 'sha')

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

    printSkippedWarning(skipped, false, 'sha')

    expect(consoleInfoSpy.printedText()).toBe(
      '\n⚠️  Skipped 1 action pinned to branches (use --include-branches to check them)\n' +
        '   • actions/checkout@main\n' +
        '\n⚠️  Skipped 1 action that could not be updated with the current style\n' +
        '   • actions/cache@v3\n' +
        '\n⚠️  Skipped 1 action whose tag family differs from the latest release (check them manually)\n' +
        '   • christopher-buss/bedrock/packages/actions/deploy@actions-v0.1.1\n' +
        '\n⚠️  Skipped 1 action that cannot be compared with the latest tag as versions (check them manually)\n' +
        '   • docker/login-action@latest\n' +
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

      printSkippedWarning(skipped, false, 'sha')

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action pinned to branches (use --include-branches to check them)\n' +
          '   • actions/cache@v4',
      )
    })
  })

  describe('defensive branches unreachable through the public API', () => {
    /**
     * No producer emits `unknown`: the update check reports
     * ref-type-unavailable, check-failed, tag-family, branch and
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

      printSkippedWarning(skipped, false, 'sha')

      expect(consoleInfoSpy.printedText()).toBe(
        '\n⚠️  Skipped 1 action that could not be checked\n' +
          '   • actions/setup-python@stable',
      )
    })
  })
})
