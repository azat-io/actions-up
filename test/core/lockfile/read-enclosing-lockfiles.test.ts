import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readEnclosingLockfiles } from '../../../core/lockfile/read-enclosing-lockfiles'
import { readWorkflowLockfile } from '../../../core/lockfile/read-workflow-lockfile'
import { makeWorkflowLockfile } from '../../helpers/make-workflow-lockfile'

vi.mock(import('../../../core/lockfile/read-workflow-lockfile'))

/**
 * Lockfile of the repository at a root.
 *
 * @param root - Root of the repository.
 * @returns Lockfile that tracks the CI workflow of the repository.
 */
function makeLockfileOf(root: string): ReturnType<typeof makeWorkflowLockfile> {
  return makeWorkflowLockfile({
    workflows: new Set([`${root}/.github/workflows/ci.yml`]),
    path: `${root}/.github/workflows/actions.lock`,
    root,
  })
}

describe('readEnclosingLockfiles', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('reads the lockfile of every directory that encloses a scanned file, each once, ordered by path', async () => {
    let lockfiles = new Map([
      ['/projects/other', makeLockfileOf('/projects/other')],
      ['/projects/repo', makeLockfileOf('/projects/repo')],
    ])
    vi.mocked(readWorkflowLockfile).mockImplementation(root =>
      Promise.resolve(lockfiles.get(root) ?? null),
    )

    let found = await readEnclosingLockfiles([
      '/projects/repo/.github/workflows',
      '/projects/repo/.github/actions/setup',
      '/projects/other/.github/actions/lint',
    ])

    expect(found).toStrictEqual([
      lockfiles.get('/projects/other'),
      lockfiles.get('/projects/repo'),
    ])
    expect(
      vi
        .mocked(readWorkflowLockfile)
        .mock.calls.map(([root]) => root)
        .toSorted(),
    ).toStrictEqual([
      '/',
      '/projects',
      '/projects/other',
      '/projects/other/.github',
      '/projects/other/.github/actions',
      '/projects/other/.github/actions/lint',
      '/projects/repo',
      '/projects/repo/.github',
      '/projects/repo/.github/actions',
      '/projects/repo/.github/actions/setup',
      '/projects/repo/.github/workflows',
    ])
  })

  it('finds no lockfile when nothing was scanned', async () => {
    let found = await readEnclosingLockfiles([])

    expect(found).toStrictEqual([])
    expect(readWorkflowLockfile).not.toHaveBeenCalled()
  })
})
