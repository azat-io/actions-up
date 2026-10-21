import { isAbsolute, relative, resolve, join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'

import { isMissingFileError } from '../fs/is-missing-file-error'
import { readYamlDocument } from '../fs/read-yaml-document'

/**
 * Definition of an action of the repository.
 */
interface Manifest {
  /**
   * References its steps run, null when it cannot be read.
   */
  references: string[] | null

  /**
   * Real path of the definition, the way the scan of the repository is matched
   * against it.
   */
  path: string
}

/**
 * Names of the file that defines an action, in the order the runner looks for
 * them.
 */
const ACTION_MANIFESTS = ['action.yml', 'action.yaml']

/**
 * Prefixes of a reference to an action of the same repository.
 */
const LOCAL_PREFIXES = ['./', '../', '$/']

/**
 * Find the actions of the repository that tracked workflows run.
 *
 * The lockfile records the remote actions an action of the repository uses as
 * dependencies of each tracked workflow that runs it through a local reference
 * (`./` or `$/`), so a change to its definition leaves the lockfile stale too.
 * They are traced from the workflows the lockfile tracks, whatever part of the
 * repository the run scans, and each definition is read once. Workflows and
 * definitions are read as data, the way GitHub reads them, so a reference
 * written through a YAML alias counts, and so does one in a group of steps,
 * such as `parallel`, that the scan of the repository does not look into. A
 * workflow or a definition that cannot be read may run any action, and a
 * workflow that no longer exists runs none.
 *
 * @param root - Root of the repository.
 * @param workflows - Absolute paths of the tracked workflows.
 * @returns Real paths of the definitions the workflows reach, or null when a
 *   workflow or a definition could not be read.
 */
export async function traceLocalActions(
  root: string,
  workflows: Set<string>,
): Promise<Set<string> | null> {
  let reached = new Set<string>()
  let visited = new Set<string>()

  /**
   * Directories of the actions of the repository the given references run.
   *
   * @param references - References of a workflow or of an action.
   * @returns Absolute paths of the directories inside the repository, its root
   *   included.
   */
  function localDirectories(references: string[]): Set<string> {
    let directories = new Set<string>()
    for (let reference of references) {
      if (LOCAL_PREFIXES.some(prefix => reference.startsWith(prefix))) {
        let directory = resolve(root, reference.replace(/^\$\//u, ''))
        let path = relative(root, directory)
        if (!path.startsWith('..') && !isAbsolute(path)) {
          directories.add(directory)
        }
      }
    }
    return directories
  }

  /**
   * Follow local references from action to action, reading each directory once,
   * whichever workflow reaches it first.
   *
   * @param directories - Directories of the actions to read next.
   * @returns False when a definition could not be read.
   */
  async function follow(directories: Set<string>): Promise<boolean> {
    let fresh = directories.difference(visited)
    if (fresh.size === 0) {
      return true
    }
    for (let directory of fresh) {
      visited.add(directory)
    }

    let found = await Promise.all([...fresh].map(findManifest))
    let next = new Set<string>()
    let complete = true

    for (let manifest of found) {
      if (manifest) {
        reached.add(manifest.path)
        if (manifest.references) {
          next = next.union(localDirectories(manifest.references))
        } else {
          complete = false
        }
      }
    }

    return (await follow(next)) && complete
  }

  let traced = await Promise.all(
    [...workflows].map(async workflow => {
      let references: string[] | null
      try {
        references = await readReferences(workflow)
      } catch (error) {
        return isMissingFileError(error)
      }
      return references !== null && follow(localDirectories(references))
    }),
  )

  return traced.every(Boolean) ? reached : null
}

/**
 * Read the definition of an action of the repository.
 *
 * A directory without a definition defines no action. A definition that cannot
 * be looked for or read may run any action, so it is reported without its
 * references.
 *
 * @param directory - Directory a local reference names.
 * @returns The definition, or null when the directory holds none.
 */
async function findManifest(directory: string): Promise<Manifest | null> {
  let candidates = ACTION_MANIFESTS.map(name => join(directory, name))
  let paths: (string | null)[]

  try {
    paths = await Promise.all(candidates.map(findFile))
  } catch {
    return { path: candidates[0]!, references: null }
  }

  let path = paths.find(candidate => candidate !== null)
  if (!path) {
    return null
  }

  try {
    let [references, real] = await Promise.all([
      readReferences(path),
      realpath(path),
    ])
    return { path: real, references }
  } catch {
    return { references: null, path }
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
 * Read every reference a workflow or the definition of an action runs: each
 * `uses` value in it, at any depth.
 *
 * @param path - Absolute path of the file.
 * @returns The references, or null when the file is not valid YAML.
 */
async function readReferences(path: string): Promise<string[] | null> {
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

  return collectReferences(data)
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
