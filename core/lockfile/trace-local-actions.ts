import { isAbsolute, relative, resolve, join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'

import { isMissingFileError } from '../fs/is-missing-file-error'
import { readYamlDocument } from '../fs/read-yaml-document'
import { isRecord } from '../parsing/is-record'
import { ACTION_MANIFESTS } from '../constants'

/**
 * Definition of an action of the repository.
 */
interface Manifest {
  /**
   * References its steps run, null when it cannot be read.
   */
  references: string[] | null

  /**
   * Whether gh-actions-lock reads its steps, which it does for a composite
   * action whose kind is written in lower case alone, while the runner runs
   * them whatever the case.
   */
  recordable: boolean

  /**
   * Whether the repository holds no definition of the action, which then is
   * whatever the workspace holds once the workflow runs.
   */
  absent: boolean

  /**
   * Real path of the definition, the way the scan of the repository is matched
   * against it; the path it would have for an action the repository does not
   * hold.
   */
  path: string
}

/**
 * Names of the file that defines a Docker action on its own, without an action
 * definition, as the runner accepts them.
 */
const DOCKER_FILES = ['Dockerfile', 'dockerfile']

/**
 * Prefixes of a reference to an action of the same repository.
 */
const LOCAL_PREFIXES = ['./', '../', '$/']

/**
 * Prefix of a reference to an action of the same repository at the commit of
 * the workflow, which gh-actions-lock follows.
 */
const SELF_PREFIX = '$/'

/**
 * Prefix of a reference to a Docker image, which the lockfile does not pin.
 */
const DOCKER_PREFIX = 'docker://'

/**
 * Find the actions of the repository that tracked workflows run, and for each
 * workflow that runs one whether the lockfile records what it runs.
 *
 * GitHub checks the remote actions an action of the repository runs against the
 * lockfile as well, so a change to its definition may leave the lockfile stale,
 * whether a workflow runs it through `$/` or from the workspace through `./`.
 * Gh-actions-lock records them only for an action reached through `$/`
 * references alone, as dependencies of each workflow that runs it so; it never
 * follows a `./` reference, since the workspace may hold anything. So a
 * workflow records what an action runs once any of its paths to the action
 * takes `$/` references alone. A workflow that runs an action only through `./`
 * is listed for it only when the action runs remote actions: their pins may be
 * the ones of the same references the workflow runs itself, which a relock of
 * the workflow drops once it no longer does. An action the repository does not
 * hold, as one a workflow checks out from another repository while it runs, may
 * run any, so it counts as one that does. The actions are traced from the
 * workflows the lockfile tracks, whatever part of the repository the run scans,
 * and each definition is read once. Workflows and definitions are read as data,
 * the way GitHub reads them, so a reference written through a YAML alias
 * counts, and so does one in a group of steps, such as `parallel`, that the
 * scan of the repository does not look into. A definition runs the `uses` of
 * its steps only when it defines a composite action, whatever case it writes
 * the kind in, as the runner reads it. A workflow or a definition that cannot
 * be read may run any action, and a workflow that no longer exists runs none.
 *
 * @param root - Root of the repository.
 * @param workflows - Absolute real paths of the tracked workflows.
 * @returns Real paths of the definitions the workflows reach, each with the
 *   workflows that reach it and whether the lockfile records what it runs under
 *   each of them, or null when a workflow or a definition could not be read,
 *   with the path of the first that could not be, in the order of the
 *   workflows. A definition that runs no remote action is listed only for the
 *   workflows that reach it through `$/` references alone, and an action the
 *   repository does not hold only for those that reach it through `./`, by the
 *   path its definition would have.
 */
export async function traceLocalActions(
  root: string,
  workflows: Set<string>,
): Promise<
  | { reached: Map<string, Map<string, boolean>>; unreadable: null }
  | { unreadable: string; reached: null }
> {
  let manifests = new Map<string, Promise<Manifest | null>>()
  let reached = new Map<string, Map<string, boolean>>()

  /**
   * Directories of the actions of the repository the given references run, each
   * with whether the lockfile records what it runs.
   *
   * @param references - References of a workflow or of an action.
   * @param recorded - Whether the lockfile records what the workflow or the
   *   action that holds the references runs.
   * @returns Absolute paths of the directories inside the repository, its root
   *   included.
   */
  function localSteps(
    references: string[],
    recorded: boolean,
  ): Map<string, boolean> {
    let steps = new Map<string, boolean>()
    for (let reference of references) {
      if (LOCAL_PREFIXES.some(prefix => reference.startsWith(prefix))) {
        let directory = resolve(root, reference.replace(/^\$\//u, ''))
        let path = relative(root, directory)
        if (!path.startsWith('..') && !isAbsolute(path)) {
          let followed = recorded && reference.startsWith(SELF_PREFIX)
          steps.set(directory, steps.get(directory) === true || followed)
        }
      }
    }
    return steps
  }

  /**
   * Read the definition in a directory, once for every workflow.
   *
   * @param directory - Directory a local reference names.
   * @returns The definition, or null when the directory holds none.
   */
  function readManifest(directory: string): Promise<Manifest | null> {
    let manifest = manifests.get(directory) ?? findManifest(directory)
    manifests.set(directory, manifest)
    return manifest
  }

  /**
   * Follow the local references of a workflow from action to action. A
   * directory is read again only when it is reached through `$/` references
   * alone after it was reached otherwise.
   *
   * @param workflow - Workflow the references come from.
   * @param steps - Directories of the actions to read next, each with whether
   *   the lockfile records what it runs for the workflow.
   * @param visited - Directories read for the workflow, each with whether the
   *   lockfile records what it runs.
   * @returns Path of the first definition that could not be read, null when
   *   every one could.
   */
  async function follow(
    workflow: string,
    steps: Map<string, boolean>,
    visited: Map<string, boolean>,
  ): Promise<string | null> {
    let fresh = [...steps].filter(
      ([directory, recorded]) =>
        !visited.has(directory) || (recorded && !visited.get(directory)),
    )
    if (fresh.length === 0) {
      return null
    }
    for (let [directory, recorded] of fresh) {
      visited.set(directory, recorded)
    }

    let found = await Promise.all(
      fresh.map(
        async ([directory, recorded]) =>
          [await readManifest(directory), recorded] as const,
      ),
    )
    let next = new Map<string, boolean>()
    let unreadable: string | null = null

    /**
     * Gh-actions-lock refuses a `$/` reference to an action the repository does
     * not hold by itself, and records what an action reached through `$/` runs
     * only when it reads the steps of that action.
     */
    for (let [manifest, recorded] of found) {
      if (manifest && (!recorded || !manifest.absent)) {
        let records = recorded && manifest.recordable
        if (records || runsRemoteActions(manifest)) {
          let runs = reached.get(manifest.path) ?? new Map<string, boolean>()
          reached.set(manifest.path, runs)
          runs.set(workflow, runs.get(workflow) === true || records)
        }
        if (manifest.references) {
          for (let [directory, followed] of localSteps(
            manifest.references,
            records,
          )) {
            next.set(directory, next.get(directory) === true || followed)
          }
        } else {
          unreadable ??= manifest.path
        }
      }
    }

    return unreadable ?? (await follow(workflow, next, visited))
  }

  let traced = await Promise.all(
    [...workflows].map(async (workflow): Promise<string | null> => {
      let references: string[] | null
      try {
        references = await readReferences(workflow, collectReferences)
      } catch (error) {
        return isMissingFileError(error) ? null : workflow
      }
      return references === null ? workflow : (
          follow(workflow, localSteps(references, true), new Map())
        )
    }),
  )

  let unreadable = traced.find(path => path !== null)
  return unreadable === undefined ?
      { unreadable: null, reached }
    : { reached: null, unreadable }
}

/**
 * Read the definition of an action of the repository.
 *
 * A file at the path, such as a workflow that a job calls, defines no action
 * that runs others, and neither does a Dockerfile that defines a Docker action
 * on its own. Where the repository holds no definition, the action is whatever
 * the workspace holds once the workflow runs, as after a checkout of another
 * repository. A definition that cannot be looked for or read may run any
 * action, so it is reported without its references.
 *
 * @param directory - Directory a local reference names.
 * @returns The definition, or null when a file is at the path or a Dockerfile
 *   alone defines the action.
 */
async function findManifest(directory: string): Promise<Manifest | null> {
  let candidates = ACTION_MANIFESTS.map(name => join(directory, name))
  let others = [directory, ...DOCKER_FILES.map(name => join(directory, name))]
  let found: (string | null)[]

  let unreadable = {
    recordable: false,
    references: null,
    absent: false,
  }

  try {
    found = await Promise.all([...candidates, ...others].map(findFile))
  } catch {
    return { ...unreadable, path: candidates[0]! }
  }

  let path = found
    .slice(0, candidates.length)
    .find(candidate => candidate !== null)
  if (!path) {
    return found.some(Boolean) ? null : (
        {
          path: candidates[0]!,
          recordable: false,
          references: [],
          absent: true,
        }
      )
  }

  try {
    let [steps, real] = await Promise.all([
      readReferences(path, readSteps),
      realpath(path),
    ])
    return steps ?
        { ...steps, absent: false, path: real }
      : { ...unreadable, path: real }
  } catch {
    return { ...unreadable, path }
  }
}

/**
 * Read the steps of the definition of an action: the references they run, the
 * `uses` value of each step of a composite action, and whether gh-actions-lock
 * reads them. A definition of another kind runs no step, whatever it holds, and
 * so does a `uses` key that does not belong to a step, such as an input of one.
 * The runner reads the kind in any case, while gh-actions-lock reads only
 * `composite` in lower case.
 *
 * @param definition - Definition of an action, read as data.
 * @returns The `uses` value of each step that has one, in the order of the
 *   steps, and whether gh-actions-lock reads them.
 */
function readSteps(definition: unknown): {
  references: string[]
  recordable: boolean
} {
  let runs = isRecord(definition) ? definition['runs'] : null
  if (
    !isRecord(runs) ||
    typeof runs['using'] !== 'string' ||
    runs['using'].toLowerCase() !== 'composite' ||
    !Array.isArray(runs['steps'])
  ) {
    return { recordable: false, references: [] }
  }
  return {
    references: (runs['steps'] as unknown[]).flatMap(step =>
      isRecord(step) && typeof step['uses'] === 'string' ? [step['uses']] : [],
    ),
    recordable: runs['using'] === 'composite',
  }
}

/**
 * Collect the `uses` values of a document read as data.
 *
 * @param value - Document, or a part of it.
 * @returns Every `uses` value that is a string, at any depth.
 */
function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap(item => collectReferences(item))
  }
  if (typeof value !== 'object' || value === null) {
    return []
  }
  return Object.entries(value).flatMap(([key, item]) =>
    key === 'uses' && typeof item === 'string' ?
      [item]
    : collectReferences(item),
  )
}

/**
 * Read the references a workflow or the definition of an action runs.
 *
 * @param path - Absolute path of the file.
 * @param collect - Collects the references from the file, read as data.
 * @returns What `collect` makes of the file, or null when the file is not valid
 *   YAML.
 */
async function readReferences<References>(
  path: string,
  collect: (data: unknown) => References,
): Promise<References | null> {
  let { document } = await readYamlDocument(path)
  if (document.errors.length > 0) {
    return null
  }

  let data: unknown
  try {
    data = document.toJSON()
  } catch {
    return null
  }

  return collect(data)
}

/**
 * Tell whether the definition of an action of the repository runs a remote
 * action, one the lockfile would pin.
 *
 * @param manifest - Definition of the action.
 * @returns True when one of its references is neither local nor a Docker image,
 *   or when the repository does not hold the action, which may then run any.
 */
function runsRemoteActions(manifest: Manifest): boolean {
  return (
    manifest.absent ||
    (manifest.references ?? []).some(
      reference =>
        LOCAL_PREFIXES.every(prefix => !reference.startsWith(prefix)) &&
        !reference.startsWith(DOCKER_PREFIX),
    )
  )
}

/**
 * Look for a file.
 *
 * @param path - Absolute path.
 * @returns The path when a file is there, null when there is none.
 * @throws Error - When the path cannot be checked, such as for want of
 *   permission.
 */
async function findFile(path: string): Promise<string | null> {
  try {
    return (await stat(path)).isFile() ? path : null
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}
