import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import { resolveScanDirectories } from '../../cli/resolve-scan-directories'

describe('resolveScanDirectories', () => {
  let cwd = '/repo'

  it('defaults to .github when recursive mode is off', () => {
    let directories = resolveScanDirectories({ cwd })

    expect(directories).toEqual([{ dir: '.github', root: cwd }])
  })

  it('defaults to current directory when recursive mode is on', () => {
    let directories = resolveScanDirectories({
      recursive: true,
      cwd,
    })

    expect(directories).toEqual([{ root: resolve(cwd, '.'), dir: '.' }])
  })

  it('uses explicit dir when provided', () => {
    let directories = resolveScanDirectories({
      dir: './nested/.github',
      recursive: true,
      cwd,
    })

    expect(directories).toEqual([
      { root: resolve(cwd, 'nested/.github'), dir: '.' },
    ])
  })

  it('normalizes and deduplicates repeatable --dir values', () => {
    let directories = resolveScanDirectories({
      dir: ['.github', './.github', '/repo/.github', 'templates'],
      cwd,
    })

    expect(directories).toEqual([
      { dir: '.github', root: cwd },
      { dir: 'templates', root: cwd },
    ])
  })

  it('resolves parent-relative path in recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: '../outside',
      recursive: true,
      cwd,
    })

    expect(directories).toEqual([
      { root: resolve(cwd, '../outside'), dir: '.' },
    ])
  })

  it('resolves parent-relative path in non-recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: '../outside/.github',
      cwd,
    })

    expect(directories).toEqual([
      { root: resolve(cwd, '../outside'), dir: '.github' },
    ])
  })

  it('resolves absolute path in recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: '/absolute/path',
      recursive: true,
      cwd,
    })

    expect(directories).toEqual([{ root: '/absolute/path', dir: '.' }])
  })

  it('uses .github when --dir points to cwd in non-recursive mode', () => {
    let directories = resolveScanDirectories({
      dir: '.',
      cwd,
    })

    expect(directories).toEqual([{ dir: '.github', root: cwd }])
  })
})
