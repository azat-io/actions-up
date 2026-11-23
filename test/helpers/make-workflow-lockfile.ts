import type { WorkflowLockfile } from '../../types/workflow-lockfile'

/**
 * Workflow lockfile of `/repo` as the reader reports it: one that tracks the CI
 * workflow, which pins nothing and runs no action of the repository. As with
 * the reader, the workflows that run actions through `./` are unknown whenever
 * the actions the workflows run are.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh lockfile.
 */
export function makeWorkflowLockfile(
  overrides: Partial<WorkflowLockfile> = {},
): WorkflowLockfile {
  return {
    keys: new Map([
      ['.github/workflows/ci.yml', '/repo/.github/workflows/ci.yml'],
    ]),
    unfollowed: overrides.reached === null ? null : new Set(),
    workflows: new Set(['/repo/.github/workflows/ci.yml']),
    pins: new Map([['.github/workflows/ci.yml', []]]),
    path: '/repo/.github/workflows/actions.lock',
    commits: new Map(),
    reached: new Map(),
    version: 'v0.0.3',
    unreadable: null,
    root: '/repo',
    ...overrides,
  }
}
