import { describe, expect, it } from 'vitest'

import type { WorkflowLockfile } from '../../../types/workflow-lockfile'
import type { GitHubAction } from '../../../types/github-action'

import { isLockedReference } from '../../../core/lockfile/is-locked-reference'
import { makeWorkflowLockfile } from '../../helpers/make-workflow-lockfile'

const SETUP_ACTION = '/repo/.github/actions/setup/action.yml'

/**
 * Lockfile of `/repo` that tracks its CI workflow, which runs the setup action
 * of the repository.
 */
const LOCKFILE = makeWorkflowLockfile({ reached: new Set([SETUP_ACTION]) })

/**
 * Lockfile of `/repo` whose tracked workflows could not be traced.
 */
const UNTRACED = makeWorkflowLockfile({ reached: null })

/**
 * Lockfile of `/repo` that cannot be read, next to workflows that cannot be
 * listed either.
 */
const UNLISTED = makeWorkflowLockfile({
  error: 'unreadable file',
  workflows: null,
  reached: null,
  version: null,
})

/**
 * Step action of the CI workflow.
 *
 * @param overrides - Fields to replace.
 * @returns Scanned action.
 */
function makeAction(overrides: Partial<GitHubAction> = {}): GitHubAction {
  return {
    file: '/repo/.github/workflows/ci.yml',
    ref: 'actions/checkout@v4',
    name: 'actions/checkout',
    type: 'external',
    version: 'v4',
    line: 7,
    ...overrides,
  }
}

describe('isLockedReference', () => {
  it.each<{
    overrides: Partial<GitHubAction>
    lockfile: WorkflowLockfile
    entry: string
  }>([
    {
      entry: 'an action of a step of a tracked workflow',
      lockfile: LOCKFILE,
      overrides: {},
    },
    {
      entry: 'an action of an action of the repository a tracked workflow runs',
      overrides: { file: SETUP_ACTION },
      lockfile: LOCKFILE,
    },
    {
      entry:
        'an action of any action of the repository when the workflows could not be traced',
      overrides: { file: '/repo/tools/lint/action.yaml' },
      lockfile: UNTRACED,
    },
    {
      entry:
        'an action of any workflow next to the lockfile when the workflows could not be listed',
      overrides: { file: '/repo/.github/workflows/release.yaml' },
      lockfile: UNLISTED,
    },
    {
      entry:
        'an action of any action of the repository when the workflows could not be listed',
      overrides: { file: '/repo/.github/actions/setup/action.yml' },
      lockfile: UNLISTED,
    },
  ])('locks $entry', ({ overrides, lockfile }) => {
    expect(isLockedReference(lockfile, makeAction(overrides))).toBe(true)
  })

  it.each<{
    overrides: Partial<GitHubAction>
    lockfile: WorkflowLockfile
    entry: string
  }>([
    {
      entry: 'an action of a workflow the lockfile does not track',
      overrides: { file: '/repo/.github/workflows/release.yml' },
      lockfile: LOCKFILE,
    },
    {
      entry: 'an action of an action of the repository no workflow runs',
      overrides: { file: '/repo/tools/lint/action.yaml' },
      lockfile: LOCKFILE,
    },
    {
      entry:
        'an action of an action outside the repository when the workflows could not be traced',
      overrides: { file: '/elsewhere/action.yml' },
      lockfile: UNTRACED,
    },
    {
      entry:
        'an action of a file that defines no action when the workflows could not be traced',
      overrides: { file: '/repo/.github/actions/setup/config.yml' },
      lockfile: UNTRACED,
    },
    {
      overrides: {
        name: 'acme/shared/.github/workflows/build.yml',
        type: 'reusable-workflow',
        ref: 'acme/shared@v1',
      },
      entry: 'a remote reusable workflow, which gh-actions-lock does not lock',
      lockfile: LOCKFILE,
    },
    {
      overrides: { name: './.github/actions/setup', type: 'local' },
      entry: 'a local action',
      lockfile: LOCKFILE,
    },
    {
      overrides: {
        version: 'ubuntu-24.04',
        name: 'runner/ubuntu',
        type: 'runner',
      },
      entry: 'a runner label',
      lockfile: LOCKFILE,
    },
    {
      entry: 'an action of no known file',
      overrides: { file: undefined },
      lockfile: LOCKFILE,
    },
    {
      entry:
        'an action of a workflow in a directory below the lockfile when the workflows could not be listed',
      overrides: { file: '/repo/.github/workflows/nested/ci.yml' },
      lockfile: UNLISTED,
    },
    {
      entry:
        'an action of a YAML file elsewhere when the workflows could not be listed',
      overrides: { file: '/repo/ci/workflow.yml' },
      lockfile: UNLISTED,
    },
  ])('does not lock $entry', ({ overrides, lockfile }) => {
    expect(isLockedReference(lockfile, makeAction(overrides))).toBe(false)
  })
})
