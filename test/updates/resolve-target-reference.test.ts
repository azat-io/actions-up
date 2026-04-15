import { describe, expect, it } from 'vitest'

import type { ActionUpdate } from '../../types/action-update'

import { resolveTargetReference } from '../../core/updates/resolve-target-reference'

function createUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    action: {
      name: 'actions/checkout',
      type: 'external',
      version: 'v4',
    },
    latestSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    latestVersion: 'v5.0.0',
    currentRefType: 'tag',
    currentVersion: 'v4',
    isBreaking: false,
    publishedAt: null,
    hasUpdate: true,
    ...overrides,
  }
}

describe('resolveTargetReference', () => {
  it('resolves sha target in sha style', () => {
    let result = resolveTargetReference(createUpdate(), 'sha')

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('resolves tag target in preserve style for tag refs', () => {
    let result = resolveTargetReference(createUpdate(), 'preserve')

    expect(result.targetRef).toBe('v5.0.0')
    expect(result.targetRefStyle).toBe('tag')
  })

  it('keeps sha target in preserve style for sha refs', () => {
    let result = resolveTargetReference(
      createUpdate({
        currentVersion: 'abcdef1',
        currentRefType: 'sha',
      }),
      'preserve',
    )

    expect(result.targetRef).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.targetRefStyle).toBe('sha')
  })

  it('returns null target when sha style has no sha', () => {
    let result = resolveTargetReference(
      createUpdate({
        latestSha: null,
      }),
      'sha',
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when preserve style cannot preserve ref type', () => {
    let result = resolveTargetReference(
      createUpdate({
        currentRefType: 'branch',
      }),
      'preserve',
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when preserve style keeps sha refs but latest sha is missing', () => {
    let result = resolveTargetReference(
      createUpdate({
        currentVersion: 'abcdef1',
        currentRefType: 'sha',
        latestSha: null,
      }),
      'preserve',
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })

  it('returns null target when update is not actionable', () => {
    let result = resolveTargetReference(
      createUpdate({
        hasUpdate: false,
      }),
      'preserve',
    )

    expect(result.targetRef).toBeNull()
    expect(result.targetRefStyle).toBeNull()
  })
})
