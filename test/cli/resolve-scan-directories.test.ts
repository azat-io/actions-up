import { describe, expect, it } from 'vitest'

import { resolveScanDirectories } from '../../cli/resolve-scan-directories'

describe('resolveScanDirectories', () => {
  it('scans .github in the current directory when recursive mode is off', () => {
    let directories = resolveScanDirectories({ cwd: '/repo' })

    expect(directories).toEqual([{ dir: '.github', root: '/repo' }])
  })

  it('makes the current directory the scan root in recursive mode without --dir', () => {
    let directories = resolveScanDirectories({ recursive: true, cwd: '/repo' })

    expect(directories).toEqual([{ root: '/repo', dir: '.' }])
  })

  it('makes a --dir directory the scan root in recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: './nested/.github',
      recursive: true,
      cwd: '/repo',
    })

    expect(directories).toEqual([{ root: '/repo/nested/.github', dir: '.' }])
  })

  it('normalizes and deduplicates repeatable --dir values', () => {
    let directories = resolveScanDirectories({
      dir: ['.github', './.github', '/repo/.github', 'templates'],
      cwd: '/repo',
    })

    expect(directories).toEqual([
      { dir: '.github', root: '/repo' },
      { dir: 'templates', root: '/repo' },
    ])
  })

  it('makes a parent-relative --dir the scan root in recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: '../outside',
      recursive: true,
      cwd: '/repo',
    })

    expect(directories).toEqual([{ root: '/outside', dir: '.' }])
  })

  it('splits a --dir outside the current directory into its parent and its name', () => {
    let directories = resolveScanDirectories({
      dir: '../outside/.github',
      cwd: '/repo',
    })

    expect(directories).toEqual([{ root: '/outside', dir: '.github' }])
  })

  it('makes an absolute --dir the scan root in recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: '/absolute/path',
      recursive: true,
      cwd: '/repo',
    })

    expect(directories).toEqual([{ root: '/absolute/path', dir: '.' }])
  })

  it('scans .github when --dir points to the current directory in non-recursive mode', () => {
    let directories = resolveScanDirectories({ cwd: '/repo', dir: '.' })

    expect(directories).toEqual([{ dir: '.github', root: '/repo' }])
  })
})
