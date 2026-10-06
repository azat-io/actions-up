import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import type {
  RunnerFamily,
  RunnerImage,
} from '../../../core/runners/known-runner-labels'

import * as knownRunnerLabels from '../../../core/runners/known-runner-labels'
import { parseRunnerLabel } from '../../../core/runners/parse-runner-label'

/**
 * Build a runner catalog that differs from the bundled one, so the parsing
 * rules hold whatever images the bundled catalog lists today.
 *
 * @returns Catalog with an older and a newer stable image per family and an
 *   ubuntu preview image.
 */
function makeCatalog(): Record<RunnerFamily, RunnerImage[]> {
  return {
    ubuntu: [
      { version: '20.04' },
      { version: '22.04' },
      { version: '24.04', preview: true },
    ],
    windows: [{ version: '2019' }, { version: '2022' }],
    macos: [{ version: '13' }, { version: '14' }],
  }
}

describe('parseRunnerLabel', () => {
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
        expected: { version: '22.04', family: 'ubuntu' },
        role: 'an ubuntu image with a dotted version',
        label: 'ubuntu-22.04',
      },
      {
        expected: { family: 'macos', version: '14' },
        role: 'a macos image',
        label: 'macos-14',
      },
      {
        expected: { family: 'windows', version: '2019' },
        role: 'a windows image',
        label: 'windows-2019',
      },
      {
        expected: { version: '24.04', family: 'ubuntu' },
        role: 'a preview image',
        label: 'ubuntu-24.04',
      },
    ])('parses $label, $role', ({ expected, label }) => {
      expect(parseRunnerLabel(label)).toStrictEqual(expected)
    })

    it.each([
      'ubuntu-latest',
      'macos-latest',
      'windows-latest',
      'self-hosted',
      `\${{ matrix.os }}`,
      'ubuntu-22.04-arm',
      'macos-14-large',
      'macos-14-xlarge',
      'macos-14-intel',
      'windows-11-arm',
      'windows-2022-vs2026',
      'self-hosted-ubuntu-22.04',
      'ubuntu-slim',
      'ubuntu',
      'Ubuntu-22.04',
      '',
    ])('returns null for %j, which is not a bare runner label', label => {
      expect(parseRunnerLabel(label)).toBeNull()
    })

    it.each([
      { role: 'a retired image', label: 'ubuntu-18.04' },
      { role: 'a retired image', label: 'macos-12' },
      { role: 'a retired image', label: 'windows-2016' },
      {
        role: 'an image released after the catalog was written',
        label: 'ubuntu-99.04',
      },
    ])('returns null for $label, $role', ({ label }) => {
      expect(parseRunnerLabel(label)).toBeNull()
    })
  })

  describe('with the bundled catalog', () => {
    it.each([
      {
        expected: { version: '22.04', family: 'ubuntu' },
        label: 'ubuntu-22.04',
      },
      {
        expected: { family: 'macos', version: '26' },
        label: 'macos-26',
      },
      {
        expected: { family: 'windows', version: '2025' },
        label: 'windows-2025',
      },
    ])('parses $label into its family and version', ({ expected, label }) => {
      expect(parseRunnerLabel(label)).toStrictEqual(expected)
    })

    it.each(['ubuntu-20.04', 'macos-13', 'windows-2019'])(
      'returns null for the retired image %s',
      label => {
        expect(parseRunnerLabel(label)).toBeNull()
      },
    )

    it('returns null for ubuntu-99.04, an image released after the catalog was written', () => {
      expect(parseRunnerLabel('ubuntu-99.04')).toBeNull()
    })
  })
})
