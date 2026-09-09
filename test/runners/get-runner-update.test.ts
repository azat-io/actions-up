import { afterEach, describe, expect, it, vi } from 'vitest'

import * as knownRunnerLabels from '../../core/runners/known-runner-labels'
import { getRunnerUpdate } from '../../core/runners/get-runner-update'

describe('getRunnerUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('upgrades an outdated ubuntu label to the newest stable image', () => {
    expect(getRunnerUpdate('ubuntu-22.04')).toBe('ubuntu-24.04')
  })

  it('upgrades an outdated macos label', () => {
    expect(getRunnerUpdate('macos-14')).toBe('macos-26')
  })

  it('upgrades an outdated windows label', () => {
    expect(getRunnerUpdate('windows-2022')).toBe('windows-2025')
  })

  it('returns null when the label is already the newest stable image', () => {
    expect(getRunnerUpdate('ubuntu-24.04')).toBeNull()
    expect(getRunnerUpdate('macos-26')).toBeNull()
    expect(getRunnerUpdate('windows-2025')).toBeNull()
  })

  it('never offers a preview image as the update target', () => {
    expect(getRunnerUpdate('ubuntu-22.04')).not.toBe('ubuntu-26.04')
  })

  it('never downgrades a label that is already on a preview image', () => {
    expect(getRunnerUpdate('ubuntu-26.04')).toBeNull()
  })

  it('returns null for a label that is not a known runner image', () => {
    expect(getRunnerUpdate('ubuntu-latest')).toBeNull()
    expect(getRunnerUpdate('self-hosted')).toBeNull()
  })

  it('returns null when a family has no stable image at all', () => {
    vi.spyOn(knownRunnerLabels, 'KNOWN_RUNNER_IMAGES', 'get').mockReturnValue({
      ubuntu: [{ version: '22.04', preview: true }],
      windows: [],
      macos: [],
    })
    expect(getRunnerUpdate('ubuntu-22.04')).toBeNull()
  })
})
