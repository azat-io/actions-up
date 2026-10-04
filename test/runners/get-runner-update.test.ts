import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type {
  RunnerFamily,
  RunnerImage,
} from '../../core/runners/known-runner-labels'

import * as knownRunnerLabels from '../../core/runners/known-runner-labels'
import { getRunnerUpdate } from '../../core/runners/get-runner-update'

/**
 * Build a runner catalog that differs from the bundled one, so the update rules
 * hold whatever images the bundled catalog lists today.
 *
 * @param overrides - Families whose images replace the defaults.
 * @returns Catalog with an ubuntu preview image after the stable ones and a
 *   macos image between the oldest and the newest one.
 */
function makeCatalog(
  overrides: Partial<Record<RunnerFamily, RunnerImage[]>> = {},
): Record<RunnerFamily, RunnerImage[]> {
  return {
    ...structuredClone({
      ubuntu: [
        { version: '20.04' },
        { version: '22.04' },
        { version: '24.04', preview: true },
      ],
      macos: [{ version: '12' }, { version: '13' }, { version: '14' }],
      windows: [{ version: '2019' }, { version: '2022' }],
    }),
    ...overrides,
  }
}

describe('getRunnerUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('with a catalog of known images', () => {
    beforeEach(() => {
      vi.spyOn(knownRunnerLabels, 'KNOWN_RUNNER_IMAGES', 'get').mockReturnValue(
        makeCatalog(),
      )
    })

    it.each([
      {
        role: 'skipping the preview image after it',
        expected: 'ubuntu-22.04',
        label: 'ubuntu-20.04',
      },
      {
        role: 'skipping the image in between',
        expected: 'macos-14',
        label: 'macos-12',
      },
      {
        role: 'in the windows family',
        expected: 'windows-2022',
        label: 'windows-2019',
      },
    ])(
      'moves $label to the newest stable image, $role',
      ({ expected, label }) => {
        expect(getRunnerUpdate(label)).toBe(expected)
      },
    )

    it.each(['ubuntu-22.04', 'macos-14', 'windows-2022'])(
      'returns null for %s, which is already the newest stable image',
      label => {
        expect(getRunnerUpdate(label)).toBeNull()
      },
    )

    it('never moves a label on a preview image back to the newest stable one', () => {
      expect(getRunnerUpdate('ubuntu-24.04')).toBeNull()
    })

    it.each(['ubuntu-latest', 'self-hosted', 'ubuntu-18.04'])(
      'returns null for %s, which is not a known image',
      label => {
        expect(getRunnerUpdate(label)).toBeNull()
      },
    )
  })

  describe('with the bundled catalog', () => {
    it.each([
      { expected: 'ubuntu-24.04', label: 'ubuntu-22.04' },
      { expected: 'macos-26', label: 'macos-14' },
      { expected: 'windows-2025', label: 'windows-2022' },
    ])(
      'moves the outdated label $label to the newest stable image $expected',
      ({ expected, label }) => {
        expect(getRunnerUpdate(label)).toBe(expected)
      },
    )

    it.each(['ubuntu-24.04', 'macos-26', 'windows-2025'])(
      'returns null for %s, which is already the newest stable image',
      label => {
        expect(getRunnerUpdate(label)).toBeNull()
      },
    )

    it('never moves the ubuntu preview image back to the newest stable one', () => {
      expect(getRunnerUpdate('ubuntu-26.04')).toBeNull()
    })

    it.each(['ubuntu-20.04', 'macos-13', 'windows-2019'])(
      'returns null for the retired image %s',
      label => {
        expect(getRunnerUpdate(label)).toBeNull()
      },
    )
  })

  describe('defensive branches unreachable through the public API', () => {
    it('returns null when a family has no stable image at all', () => {
      vi.spyOn(knownRunnerLabels, 'KNOWN_RUNNER_IMAGES', 'get').mockReturnValue(
        makeCatalog({ ubuntu: [{ version: '22.04', preview: true }] }),
      )

      expect(getRunnerUpdate('ubuntu-22.04')).toBeNull()
    })
  })
})
