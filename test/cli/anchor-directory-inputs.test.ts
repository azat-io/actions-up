import { describe, expect, it } from 'vitest'

import { anchorDirectoryInputs } from '../../cli/anchor-directory-inputs'

describe('anchorDirectoryInputs', () => {
  it('returns the --dir value unchanged when no root is found', () => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', dir: '.gitea', root: null }),
    ).toBe('.gitea')
  })

  it('returns the --dir value unchanged when the root equals the cwd', () => {
    expect(
      anchorDirectoryInputs({ root: '/repo', dir: '.gitea', cwd: '/repo' }),
    ).toBe('.gitea')
  })

  it.each([
    { input: 'without --dir', dir: undefined },
    { input: 'for --dir "."', dir: '.' },
  ])('anchors the default .github at the repository root $input', ({ dir }) => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', root: '/repo', dir }),
    ).toEqual(['/repo/.github'])
  })

  it('anchors a simple relative --dir at the repository root', () => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', dir: '.gitea', root: '/repo' }),
    ).toEqual(['/repo/.gitea'])
  })

  it('anchors multiple --dir values at the repository root', () => {
    expect(
      anchorDirectoryInputs({ dir: ['x', 'y'], cwd: '/repo/a', root: '/repo' }),
    ).toEqual(['/repo/x', '/repo/y'])
  })

  it.each([
    { kind: 'a parent-relative', dir: '../x' },
    { kind: 'an absolute', dir: '/abs' },
  ])('leaves $kind --dir untouched', ({ dir }) => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', root: '/repo', dir }),
    ).toEqual([dir])
  })
})
