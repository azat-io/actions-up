import { realpath, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'

import type { WorkflowLockfile } from '../../types/workflow-lockfile'

import {
  WORKFLOWS_DIRECTORY,
  GITHUB_DIRECTORY,
  LOCKFILE_NAME,
} from '../constants'
import { isMissingFileError } from '../fs/is-missing-file-error'
import { traceLocalActions } from './trace-local-actions'
import { parseLockfile } from './parse-lockfile'
import { isYamlFile } from '../fs/is-yaml-file'

/**
 * What the lockfile says about the workflows it tracks.
 */
interface LockfileContents extends Pick<WorkflowLockfile, 'version' | 'error'> {
  /**
   * Absolute paths of the workflows treated as tracked, null when they cannot
   * be listed.
   */
  workflows: Set<string> | null
}

/**
 * Read the workflow lockfile of a repository.
 *
 * A repository without the file does not use one. A file that exists but cannot
 * be read, or that this release does not understand, still means the repository
 * does: GitHub checks the workflows it tracks against it, and writing them as
 * if it were not there would leave it stale. The tracked workflows cannot be
 * told apart then, so every workflow of `.github/workflows` is treated as
 * tracked, and when even that directory cannot be listed, any workflow there
 * may be tracked and may run any action of the repository. The actions of the
 * repository the workflows run are traced as well, since writing one of them
 * leaves the lockfile stale too. The lockfile and its workflows are named by
 * their real paths, so that a file found through a symbolic link is matched
 * with the one it points to.
 *
 * @param root - Root of the repository.
 * @returns The lockfile, or null when the repository has none.
 */
export async function readWorkflowLockfile(
  root: string,
): Promise<WorkflowLockfile | null> {
  let workflowsDirectory = join(root, GITHUB_DIRECTORY, WORKFLOWS_DIRECTORY)
  let path = join(workflowsDirectory, LOCKFILE_NAME)
  let contents = await readContents(path, root)

  if (!contents) {
    return null
  }

  let workflows =
    contents.workflows &&
    new Set(await Promise.all([...contents.workflows].map(toRealPath)))

  return {
    ...contents,
    reached: workflows ? await traceLocalActions(root, workflows) : null,
    path: join(await toRealPath(workflowsDirectory), LOCKFILE_NAME),
    workflows,
    root,
  }
}

/**
 * Read which workflows the lockfile tracks.
 *
 * @param path - Absolute path of the lockfile.
 * @param root - Root of the repository.
 * @returns The tracked workflows with the schema version, or null when there is
 *   no lockfile.
 */
async function readContents(
  path: string,
  root: string,
): Promise<LockfileContents | null> {
  let workflowsDirectory = dirname(path)
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    return {
      workflows: await listWorkflows(workflowsDirectory),
      error: 'unreadable file',
      version: null,
    }
  }

  let parsed = parseLockfile(text)

  if (parsed.kind === 'unsupported') {
    return {
      workflows: await listWorkflows(workflowsDirectory),
      version: parsed.version,
      error: parsed.reason,
    }
  }

  return {
    workflows: new Set(
      parsed.workflows.map(workflow => resolve(root, workflow)),
    ),
    version: parsed.version,
  }
}

/**
 * List every workflow of a workflows directory.
 *
 * @param directory - Absolute path of `.github/workflows`.
 * @returns Absolute paths of the YAML files in it, or null when the directory
 *   cannot be listed.
 */
async function listWorkflows(directory: string): Promise<Set<string> | null> {
  try {
    let names = await readdir(directory)
    return new Set(
      names.filter(name => isYamlFile(name)).map(name => join(directory, name)),
    )
  } catch {
    return null
  }
}

/**
 * Resolve the symbolic links of a path.
 *
 * @param path - Absolute path.
 * @returns Real path, or the path as given when it cannot be resolved.
 */
async function toRealPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}
