import { describe, expect, it } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'
import type { GitHubAction } from '../../types/github-action'

import { filterDowngradeUpdates } from '../../cli/filter-downgrade-updates'

/**
 * Path used as the file cache key for workflow content in tests.
 */
let workflowFile = '/repo/.github/workflows/ci.yml'

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
    let update = createUpdate()

    update = withComment(update, ' v12.3119.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([update])
    expect(kept).toEqual([])
  })

  it('blocks a downgrade even when the latest sha is unknown', () => {
    /**
     * Check-updates marks sha-pinned actions as outdated unconditionally when
     * latestSha is missing; the guard compares versions only, so it still
     * protects that path.
     */
    let update = createUpdate({ latestSha: null })

    update = withComment(update, ' v12.3119.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([update])
    expect(kept).toEqual([])
  })

  it('keeps an upgrade of a sha-pinned action', () => {
    let update = createUpdate({ latestVersion: 'v1.3.0' })

    update = withComment(update, ' v1.2.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps an equal-version re-pin to the canonical sha', () => {
    let update = createUpdate({ latestVersion: 'v1.2.0' })

    update = withComment(update, ' v1.2.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('blocks a prerelease pin above the latest version', () => {
    /**
     * Version normalization coerces away prerelease suffixes, so the pin is
     * compared as 2.0.0.
     */
    let update = createUpdate({ latestVersion: 'v1.9.0' })

    update = withComment(update, ' v2.0.0-rc.1')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([update])
    expect(kept).toEqual([])
  })

  it('keeps a prerelease pin matching the latest version', () => {
    let update = createUpdate({ latestVersion: 'v2.0.0' })

    update = withComment(update, ' v2.0.0-rc.1')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates without an inline version comment', () => {
    let update = createUpdate()

    update = withComment(update, null)

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates with a non-version comment', () => {
    let update = createUpdate()

    update = withComment(update, ' some note')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('ignores actions referenced by tags', () => {
    /**
     * The inline comment is only meaningful next to sha pins; a higher version
     * in a comment must not block tag references.
     */
    let update = createUpdate({
      action: createAction({ uses: 'owner/repo@v1', version: 'v1' }),
      latestVersion: 'v2.0.0',
      currentVersion: 'v1',
    })

    update = withComment(update, ' v99.0.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates without a latest version', () => {
    let update = createUpdate({ latestVersion: null })

    update = withComment(update, ' v12.3119.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates when latest resolves to a floating major', () => {
    /**
     * A floating tag like v12 moves with releases, so its SHA can be ahead of
     * the pin even though the coerced version (12.0.0) compares lower.
     */
    let update = createUpdate({ latestVersion: 'v12' })

    update = withComment(update, ' v12.3119.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates when latest resolves to a floating minor', () => {
    let update = createUpdate({ latestVersion: 'v12.1' })

    update = withComment(update, ' v12.1.5')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates with a date-like comment', () => {
    /**
     * Comments such as audit dates must not masquerade as version claims.
     */
    let update = createUpdate()

    update = withComment(update, ' 2024-05-01 audited')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('keeps updates with a non-semver latest version', () => {
    let update = createUpdate({ latestVersion: 'nightly' })

    update = withComment(update, ' v12.3119.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([])
    expect(kept).toEqual([update])
  })

  it('blocks downgrades of sha-pinned reusable workflows', () => {
    let update = createUpdate({
      action: createAction({
        uses: 'owner/repo/.github/workflows/reusable.yml@59b9d7edfcad5b87fbe3f473a9a134a721ad03f8',
        name: 'owner/repo/.github/workflows/reusable.yml',
        type: 'reusable-workflow',
      }),
      latestVersion: 'v2.0.0',
    })

    update = withComment(update, ' v3.0.0')

    let { blocked, kept } = filterDowngradeUpdates([update])

    expect(blocked).toEqual([update])
    expect(kept).toEqual([])
  })

  it('splits mixed updates preserving order', () => {
    let downgrade = createUpdate()
    let upgrade = createUpdate({
      action: createAction({
        uses: 'owner/other@v1',
        name: 'owner/other',
        version: 'v1',
      }),
      latestVersion: 'v2.0.0',
      currentVersion: 'v1',
    })

    upgrade = withComment(upgrade, ' v12.3119.0')
    downgrade = withComment(downgrade, ' v12.3119.0')

    let { blocked, kept } = filterDowngradeUpdates([upgrade, downgrade])

    expect(blocked).toEqual([downgrade])
    expect(kept).toEqual([upgrade])
  })

  it('blocks a downgrade inside a prefixed tag family', () => {
    let update = createUpdate({ latestVersion: 'actions-v0.1.1' })

    update = withComment(update, ' actions-v0.2.0')

    let result = filterDowngradeUpdates([update])

    expect(result.blocked).toHaveLength(1)
    expect(result.kept).toHaveLength(0)
  })

  it('keeps an upgrade inside a prefixed tag family', () => {
    let update = createUpdate({ latestVersion: 'actions-v0.2.0' })

    update = withComment(update, ' actions-v0.1.1')

    let result = filterDowngradeUpdates([update])

    expect(result.kept).toHaveLength(1)
    expect(result.blocked).toHaveLength(0)
  })

  it('never compares versions across tag families', () => {
    let update = createUpdate({ latestVersion: 'v0.1.0' })

    update = withComment(update, ' actions-v0.2.0')

    let result = filterDowngradeUpdates([update])

    expect(result.kept).toHaveLength(1)
    expect(result.blocked).toHaveLength(0)
  })
})
