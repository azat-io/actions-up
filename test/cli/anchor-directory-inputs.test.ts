import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { anchorDirectoryInputs } from '../../cli/anchor-directory-inputs'

describe('anchorDirectoryInputs', () => {
  it('returns inputs unchanged when no root is found', () => {
    expect(
      anchorDirectoryInputs({ dir: '.github', cwd: '/repo/a', root: null }),
    ).toBe('.github')
  })

  it('returns inputs unchanged when the root equals the cwd', () => {
    expect(
      anchorDirectoryInputs({ root: '/repo', cwd: '/repo' }),
    ).toBeUndefined()
  })

  it('anchors the default .github at the repository root', () => {
    expect(anchorDirectoryInputs({ cwd: '/repo/a', root: '/repo' })).toEqual([
      join('/repo', '.github'),
    ])
  })

  it('anchors a simple relative --dir at the repository root', () => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', dir: '.gitea', root: '/repo' }),
    ).toEqual([join('/repo', '.gitea')])
  })

  it('anchors multiple --dir values at the repository root', () => {
    expect(
      anchorDirectoryInputs({ dir: ['x', 'y'], cwd: '/repo/a', root: '/repo' }),
    ).toEqual([join('/repo', 'x'), join('/repo', 'y')])
  })

  it('leaves parent-relative --dir untouched', () => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', root: '/repo', dir: '../x' }),
    ).toEqual(['../x'])
  })

  it('leaves absolute --dir untouched', () => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', root: '/repo', dir: '/abs' }),
    ).toEqual(['/abs'])
  })

  it('treats --dir "." as the default .github at the root', () => {
    expect(
      anchorDirectoryInputs({ cwd: '/repo/a', root: '/repo', dir: '.' }),
    ).toEqual([join('/repo', '.github')])
  })
})
