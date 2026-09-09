import { describe, expect, it } from 'vitest'

import { parseRunnerLabel } from '../../core/runners/parse-runner-label'

describe('parseRunnerLabel', () => {
  it('parses an ubuntu label with a dotted version', () => {
    expect(parseRunnerLabel('ubuntu-22.04')).toStrictEqual({
      version: '22.04',
      family: 'ubuntu',
    })
  })

  it('parses a macos label', () => {
    expect(parseRunnerLabel('macos-15')).toStrictEqual({
      family: 'macos',
      version: '15',
    })
  })

  it('parses a windows label', () => {
    expect(parseRunnerLabel('windows-2022')).toStrictEqual({
      family: 'windows',
      version: '2022',
    })
  })

  it('parses a preview image', () => {
    expect(parseRunnerLabel('ubuntu-26.04')).toStrictEqual({
      version: '26.04',
      family: 'ubuntu',
    })
  })

  it.each([
    'ubuntu-latest',
    'macos-latest',
    'windows-latest',
    'self-hosted',
    `\${{ matrix.os }}`,
    'ubuntu-24.04-arm',
    'macos-15-large',
    'macos-15-xlarge',
    'macos-26-intel',
    'windows-11-arm',
    'windows-2025-vs2026',
    'ubuntu-slim',
    'ubuntu',
    'Ubuntu-24.04',
    '',
  ])('returns null for %s', label => {
    expect(parseRunnerLabel(label)).toBeNull()
  })

  it('returns null for a retired image version', () => {
    expect(parseRunnerLabel('ubuntu-20.04')).toBeNull()
    expect(parseRunnerLabel('macos-12')).toBeNull()
    expect(parseRunnerLabel('windows-2019')).toBeNull()
  })

  it('returns null for a version released after the table was written', () => {
    expect(parseRunnerLabel('ubuntu-99.04')).toBeNull()
  })
})
