import { parseDocument } from 'yaml'

import type { LockfileParseResult } from '../../types/lockfile-parse-result'

import { SUPPORTED_LOCKFILE_VERSIONS } from '../constants'

/**
 * Keys the top level of a lockfile may hold. Every supported version rejects
 * any other key.
 */
const FILE_KEYS = new Set(['dependencies', 'workflows', 'version'])

/**
 * Read which workflows a workflow lockfile tracks.
 *
 * Only the keys of `workflows` are read; the rest of the file is checked for
 * its shape alone, so a field a newer release of gh-actions-lock adds to a pin
 * does not make the file unreadable. The format is still before 1.0 and may
 * change, so a file in a version this release does not know, with a key at the
 * top it does not know, or with sections that are not mappings, is reported as
 * unreadable rather than guessed at. A document whose aliases expand beyond
 * reason is unreadable too.
 *
 * @param text - Content of `.github/workflows/actions.lock`.
 * @returns The tracked workflows, or why the file cannot be read.
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

  if (
    !isSection(workflows) ||
    Object.values(workflows ?? {}).some(pins => !Array.isArray(pins))
  ) {
    return { reason: 'malformed workflows', kind: 'unsupported', version }
  }

  if (!isSection(dependencies)) {
    return { reason: 'malformed dependencies', kind: 'unsupported', version }
  }

  return { workflows: Object.keys(workflows ?? {}), kind: 'parsed', version }
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
 * Tell a YAML mapping apart from the other values a document can hold.
 *
 * @param value - Value read from the document.
 * @returns True when the value is a mapping.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
