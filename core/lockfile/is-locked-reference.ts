import { isAbsolute, basename, relative, dirname, resolve } from 'node:path'

import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { GitHubAction } from '../../types/github-action'

import { isYamlFile } from '../fs/is-yaml-file'

/**
 * Names of the file that defines an action.
 */
const ACTION_MANIFESTS = new Set(['action.yaml', 'action.yml'])

/**
 * Tell whether the workflow lockfile pins the commit a reference runs.
 *
 * For a workflow the lockfile tracks, GitHub runs the commit the lockfile
 * records for each action of its steps, whatever the reference names, and so it
 * does for the steps of an action of the repository that such a workflow runs
 * through a local reference. Writing such a reference leaves the lockfile stale
 * until it is regenerated. When the workflows next to the lockfile could not be
 * listed, any of them may be tracked, and when the actions the workflows run
 * could not be traced, any action of the repository may be one of them. Remote
 * reusable workflows called by a job are not recorded by gh-actions-lock
 * (github/gh-actions-lock#179), and runner labels are no dependencies, so the
 * reference stays their only pin.
 *
 * @param lockfile - Workflow lockfile of a repository.
 * @param action - Scanned reference, with the real path of its file.
 * @returns True when the lockfile pins the commit the reference runs.
 */
export function isLockedReference(
  lockfile: WorkflowLockfile,
  action: GitHubAction,
): boolean {
  if (action.type !== 'external' || action.file === undefined) {
    return false
  }

  let file = resolve(action.file)
  let tracked =
    lockfile.workflows ?
      lockfile.workflows.has(file)
    : dirname(file) === dirname(lockfile.path) && isYamlFile(file)

  if (tracked) {
    return true
  }

  if (lockfile.reached) {
    return lockfile.reached.has(file)
  }

  let path = relative(lockfile.root, file)
  return (
    ACTION_MANIFESTS.has(basename(file)) &&
    !path.startsWith('..') &&
    !isAbsolute(path)
  )
}
