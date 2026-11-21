import { parseDocument } from 'yaml'

import type { LockfileParseResult } from '../../types/lockfile-parse-result'

import { SUPPORTED_LOCKFILE_VERSIONS } from '../constants'
import { isRecord } from '../parsing/is-record'

/**
 * Keys the top level of a lockfile may hold. Every supported version rejects
 * any other key.
 */
const FILE_KEYS = new Set(['dependencies', 'workflows', 'version'])

/**
 * Read which workflows a workflow lockfile tracks, which references each of
 * them pins, and which commit it pins each reference to.
 *
 * Only the workflows with the keys of their pins and the commits of
 * `dependencies`, by the key of each pin, `owner/repo@ref`, are read; the
 * repository in a key is read in lower case, the way GitHub matches it. The
 * rest of the file is checked for its shape alone, so a field a newer release
 * of gh-actions-lock adds to a pin does not make the file unreadable. The
 * format is still before 1.0 and may change, so a file in a version this
 * release does not know, with a key at the top it does not know, or with
 * sections that are not mappings, is reported as unreadable rather than guessed
 * at. A document whose aliases expand beyond reason is unreadable too.
 *
 * @param text - Content of `.github/workflows/actions.lock`.
 * @returns The tracked workflows and the pinned commits, or why the file cannot
 *   be read.
 */
export function parseLockfile(text: string): LockfileParseResult {
  let document = parseDocument(text)

  if (document.errors.length > 0) {
    return { reason: 'invalid YAML', kind: 'unsupported', version: null }
  }

  let content: unknown
  try {
    content = document.toJSON()
  } catch {
    return { reason: 'invalid YAML', kind: 'unsupported', version: null }
  }

  if (!isRecord(content)) {
    return { reason: 'not a mapping', kind: 'unsupported', version: null }
  }

  let { version } = content
  if (typeof version !== 'string') {
    return { reason: 'no schema version', kind: 'unsupported', version: null }
  }

  if (!SUPPORTED_LOCKFILE_VERSIONS.has(version)) {
    return {
      reason: `unsupported schema version ${version}`,
      kind: 'unsupported',
      version,
    }
  }

  let unknownKey = Object.keys(content).find(key => !FILE_KEYS.has(key))
  if (unknownKey !== undefined) {
    return {
      reason: `unknown key ${unknownKey}`,
      kind: 'unsupported',
      version,
    }
  }

  let { dependencies, workflows } = content

  if (!isWorkflowSection(workflows)) {
    return { reason: 'malformed workflows', kind: 'unsupported', version }
  }

  if (!isSection(dependencies)) {
    return { reason: 'malformed dependencies', kind: 'unsupported', version }
  }

  return {
    commits: new Map(
      Object.entries(dependencies ?? {}).flatMap(
        ([key, pin]): [string, string][] => {
          let normalized = normalizeKey(key)
          return (
              normalized !== null &&
                isRecord(pin) &&
                typeof pin['commit'] === 'string'
            ) ?
              [[normalized, pin['commit'].replace(/^sha1-/u, '').toLowerCase()]]
            : []
        },
      ),
    ),
    pins: new Map(
      Object.entries(workflows ?? {}).map(([workflow, entries]) => [
        workflow,
        entries.flatMap(entry => {
          let key = typeof entry === 'string' ? normalizeKey(entry) : null
          return key === null ? [] : [key]
        }),
      ]),
    ),
    workflows: Object.keys(workflows ?? {}),
    kind: 'parsed',
    version,
  }
}

/**
 * Tell a `workflows` section that maps each workflow to a list of pins, or is
 * left empty, apart from one shaped otherwise.
 *
 * @param value - What the key of the section holds in the document.
 * @returns True when the section is empty or maps each workflow to a list.
 */
function isWorkflowSection(
  value: unknown,
): value is Record<string, unknown[]> | undefined | null {
  return (
    isSection(value) &&
    Object.values(value ?? {}).every(pins => Array.isArray(pins))
  )
}

/**
 * Tell a section of the lockfile that is a mapping, or left empty, apart from
 * one shaped otherwise.
 *
 * @param value - What the key of the section holds in the document.
 * @returns True when the section is a mapping or empty.
 */
function isSection(
  value: unknown,
): value is Record<string, unknown> | undefined | null {
  return value === undefined || value === null || isRecord(value)
}

/**
 * Read the key of a pin the way GitHub matches it.
 *
 * @param key - Key as the lockfile writes it, `owner/repo@ref`.
 * @returns The key with the repository in lower case, or null when it names no
 *   reference.
 */
function normalizeKey(key: string): string | null {
  let at = key.indexOf('@')
  return at > 0 ? `${key.slice(0, at).toLowerCase()}${key.slice(at)}` : null
}
