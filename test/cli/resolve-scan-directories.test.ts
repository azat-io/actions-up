import { describe, expect, it } from 'vitest'

import { resolveScanDirectories } from '../../cli/resolve-scan-directories'

describe('resolveScanDirectories', () => {
  let cwd = '/repo'

  it('defaults to .github when recursive mode is off', () => {
    let directories = resolveScanDirectories({ cwd })

    expect(directories).toEqual(['.github'])
  })

  it('defaults to current directory when recursive mode is on', () => {
    let directories = resolveScanDirectories({
      recursive: true,
      cwd,
    })

    expect(directories).toEqual(['.'])
  })

  it('uses explicit dir when provided', () => {
    let directories = resolveScanDirectories({
      dir: './nested/.github',
      recursive: true,
      cwd,
    })

    expect(directories).toEqual(['nested/.github'])
  })

  it('normalizes and deduplicates repeatable --dir values', () => {
    let directories = resolveScanDirectories({
      dir: ['.github', './.github', '/repo/.github', 'templates'],
      cwd,
    })

    expect(directories).toEqual(['.github', 'templates'])
  })
})
