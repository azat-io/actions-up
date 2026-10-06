import { describe, expect, it } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'
import type { GitHubAction } from '../../types/github-action'

import { filterDowngradeUpdates } from '../../cli/filter-downgrade-updates'

/**
 * Workflow file the fixture actions are scanned from.
 */
let workflowFile = '/repo/.github/workflows/ci.yml'

/**
 * Create an outdated update of a SHA-pinned action.
 *
 * @param overrides - Fields that differ from the default SHA-pinned update.
 * @returns Fresh update.
 */
function createUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    currentVersion: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    latestSha: '99bb2caf247dfd9f03cf984373bc6043d4e32ebf',
    latestVersion: 'v12.1347.0',
    action: createAction(),
    publishedAt: null,
    isBreaking: false,
    hasUpdate: true,
    ...overrides,
  }
}

/**
 * Create a SHA-pinned action reference.
 *
 * @param overrides - Fields that differ from the default reference.
 * @returns Fresh action reference.
 */
function createAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    uses: 'owner/repo@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    version: '59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
    file: workflowFile,
    name: 'owner/repo',
    type: 'external',
    line: 1,
    ...overrides,
  }
}

/**
 * Copy an update with a trailing comment on its `uses:` line.
 *
 * @param update - Update to copy.
 * @param comment - Comment text without the leading `#`, or null for none.
 * @returns Fresh update carrying the comment.
 */
function withComment(
  update: ActionUpdate,
  comment: string | null,
): ActionUpdate {
  return {
    ...update,
    action: { ...update.action, comment: comment ?? undefined },
  }
}

describe('filterDowngradeUpdates', () => {
  it('blocks an update that would downgrade a sha-pinned action', () => {
    let update = withComment(createUpdate(), ' v12.3119.0')

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ blocked: [update], kept: [] })
  })

  it('blocks a downgrade even when the latest sha is unknown', () => {
    /**
     * Check-updates marks sha-pinned actions as outdated unconditionally when
     * latestSha is missing; the guard compares versions only, so it still
     * protects that path.
     */
    let update = withComment(createUpdate({ latestSha: null }), ' v12.3119.0')

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ blocked: [update], kept: [] })
  })

  it('keeps an upgrade of a sha-pinned action', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'v1.3.0' }),
      ' v1.2.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps an equal-version re-pin to the canonical sha', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'v1.2.0' }),
      ' v1.2.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('blocks a prerelease pin above the latest version', () => {
    /**
     * A prerelease of a higher version still ranks above the latest release:
     * 2.0.0-rc.1 is newer than 1.9.0.
     */
    let update = withComment(
      createUpdate({ latestVersion: 'v1.9.0' }),
      ' v2.0.0-rc.1',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ blocked: [update], kept: [] })
  })

  it('keeps an update from a prerelease pin to its final release', () => {
    /**
     * A prerelease ranks below the release it precedes, so 2.0.0 is an upgrade
     * from 2.0.0-rc.1.
     */
    let update = withComment(
      createUpdate({ latestVersion: 'v2.0.0' }),
      ' v2.0.0-rc.1',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps updates without an inline version comment', () => {
    let update = withComment(createUpdate(), null)

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps updates with a non-version comment', () => {
    let update = withComment(createUpdate(), ' some note')

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('ignores actions referenced by tags', () => {
    /**
     * The inline comment is only meaningful next to sha pins; a higher version
     * in a comment must not block tag references.
     */
    let update = withComment(
      createUpdate({
        action: createAction({ uses: 'owner/repo@v1', version: 'v1' }),
        latestVersion: 'v2.0.0',
        currentVersion: 'v1',
      }),
      ' v99.0.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps updates without a latest version', () => {
    let update = withComment(
      createUpdate({ latestVersion: null }),
      ' v12.3119.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps updates when latest resolves to a floating major', () => {
    /**
     * A floating tag like v12 moves with releases, so its SHA can be ahead of
     * the pin even though the coerced version (12.0.0) compares lower.
     */
    let update = withComment(
      createUpdate({ latestVersion: 'v12' }),
      ' v12.3119.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps updates when latest resolves to a floating minor', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'v12.1' }),
      ' v12.1.5',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  /**
   * Comments such as audit dates must not masquerade as version claims, even
   * when their leading number reads as a version above the latest one.
   */
  it.each([
    ['a full date', ' 2024-05-01 audited'],
    ['a bare year', ' 2024 audit'],
  ])('keeps updates with a comment that starts with %s', (_, comment) => {
    let update = withComment(createUpdate(), comment)

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('keeps updates with a non-semver latest version', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'nightly' }),
      ' v12.3119.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('blocks downgrades of sha-pinned reusable workflows', () => {
    let update = withComment(
      createUpdate({
        action: createAction({
          uses: 'owner/repo/.github/workflows/reusable.yml@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
          name: 'owner/repo/.github/workflows/reusable.yml',
          type: 'reusable-workflow',
        }),
        latestVersion: 'v2.0.0',
      }),
      ' v3.0.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ blocked: [update], kept: [] })
  })

  it('splits mixed updates preserving order', () => {
    let firstDowngrade = withComment(createUpdate(), ' v12.3119.0')
    let tagUpgrade = withComment(
      createUpdate({
        action: createAction({
          uses: 'owner/other@v1',
          name: 'owner/other',
          version: 'v1',
        }),
        latestVersion: 'v2.0.0',
        currentVersion: 'v1',
      }),
      ' v12.3119.0',
    )
    let secondDowngrade = withComment(
      createUpdate({
        action: createAction({
          uses: 'owner/tool@3f1c2d4e5b6a79801f2e3d4c5b6a798011223344',
          version: '3f1c2d4e5b6a79801f2e3d4c5b6a798011223344',
          name: 'owner/tool',
          line: 7,
        }),
        currentVersion: '3f1c2d4e5b6a79801f2e3d4c5b6a798011223344',
        latestVersion: 'v2.0.0',
      }),
      ' v3.0.0',
    )
    let shaUpgrade = withComment(
      createUpdate({
        action: createAction({
          uses: 'owner/lib@8e7d6c5b4a3928170f6e5d4c3b2a190807060504',
          version: '8e7d6c5b4a3928170f6e5d4c3b2a190807060504',
          name: 'owner/lib',
          line: 9,
        }),
        currentVersion: '8e7d6c5b4a3928170f6e5d4c3b2a190807060504',
        latestVersion: 'v1.3.0',
      }),
      ' v1.2.0',
    )

    let result = filterDowngradeUpdates([
      firstDowngrade,
      tagUpgrade,
      secondDowngrade,
      shaUpgrade,
    ])

    expect(result).toStrictEqual({
      blocked: [firstDowngrade, secondDowngrade],
      kept: [tagUpgrade, shaUpgrade],
    })
  })

  it('blocks a downgrade inside a prefixed tag family', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'actions-v0.1.1' }),
      ' actions-v0.2.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ blocked: [update], kept: [] })
  })

  it('keeps an upgrade inside a prefixed tag family', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'actions-v0.2.0' }),
      ' actions-v0.1.1',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })

  it('never compares versions across tag families', () => {
    let update = withComment(
      createUpdate({ latestVersion: 'v0.1.0' }),
      ' actions-v0.2.0',
    )

    let result = filterDowngradeUpdates([update])

    expect(result).toStrictEqual({ kept: [update], blocked: [] })
  })
})
