import type { Scalar } from 'yaml'

import { parseAllDocuments, isScalar, visit } from 'yaml'
import { writeFile, readFile } from 'node:fs/promises'

import type { ActionUpdate } from '../../../types/action-update'

import { getLineNumberForKey } from '../utils/get-line-number'

/**
 * A `uses` or `runs-on` value written in a file.
 */
interface Occurrence {
  /**
   * Key the value belongs to.
   */
  key: 'runs-on' | 'uses'

  /**
   * 1-based line of the key, the line the scanner records for the entry.
   */
  keyLine: number

  /**
   * Value node, with its position in the file.
   */
  node: Scalar
}

/**
 * File being updated.
 */
interface UpdatedFile {
  /**
   * `uses` and `runs-on` values written in the file.
   */
  occurrences: Occurrence[]

  /**
   * Values an earlier update of the batch already rewrites.
   */
  claimed: Set<Scalar>

  /**
   * File content as read.
   */
  content: string
}

/**
 * Replacement of a span of the file.
 */
interface Edit {
  /**
   * Offset where the span starts.
   */
  start: number

  /**
   * Text that takes the place of the span.
   */
  text: string

  /**
   * Offset where the span ends.
   */
  end: number
}

/**
 * Matches a runner label that is safe to write back.
 *
 * Target labels come from the local runner table, so this only guards against a
 * caller assembling an update by hand.
 */
const RUNNER_LABEL_VALUE = /^[a-z]+-\d+(?:\.\d+)?$/u

/**
 * Text that follows a value on its line: flow delimiters and blanks, then an
 * optional comment.
 */
const AFTER_VALUE = /^(?<after>[\t ,\]{}]*)(?<comment>#[^\n\r]*)?/u

/**
 * Apply updates using the already-resolved target refs.
 *
 * Each file is parsed again when it is written. An update rewrites the `uses`
 * or `runs-on` value whose key sits on the line the scan recorded and whose
 * value is still the one the scan found, so a file edited since the scan never
 * gets a value rewritten that the update was not about. Only the value itself
 * and its trailing comment change; quotes, anchors, tags and the rest of the
 * file stay as written.
 *
 * @param updates - Array of updates to apply.
 * @returns Updates that were meant to be written but were not, in the given
 *   order: the reference was no longer found where the scan reported it, or the
 *   update named no file or no valid target. Skipped entries are never written
 *   and never reported.
 */
export async function applyUpdates(
  updates: ActionUpdate[],
): Promise<ActionUpdate[]> {
  let updatesByFile = new Map<string, ActionUpdate[]>()
  let unwritten = new Set<ActionUpdate>()

  for (let update of updates) {
    /**
     * Skipped entries carry lookup data (including `latestSha`) that must never
     * be written back, so they are dropped before the fallback chain below can
     * turn that data into a reference.
     */
    if (update.status === 'skipped') {
      continue
    }

    let { file } = update.action
    if (!file) {
      unwritten.add(update)
      continue
    }

    let fileUpdates = updatesByFile.get(file) ?? []
    fileUpdates.push(update)
    updatesByFile.set(file, fileUpdates)
  }

  await Promise.all(
    [...updatesByFile].map(async ([filePath, fileUpdates]) => {
      /**
       * A file that cannot be read or written leaves every update of its own
       * unwritten, and the other files are written all the same.
       */
      try {
        let content = await readFile(filePath, 'utf8')
        let updated = applyFileUpdates(content, fileUpdates, unwritten)
        if (updated !== content) {
          await writeFile(filePath, updated, 'utf8')
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        for (let update of fileUpdates) {
          unwritten.add(update)
        }
      }
    }),
  )

  return updates.filter(update => unwritten.has(update))
}

/**
 * Plan the rewrite of the `uses` values an update is about.
 *
 * With a recorded line, the update rewrites the value on that line; without
 * one, every value that names the action at its current version.
 *
 * @param file - File being updated.
 * @param update - Update to write.
 * @returns Edits to apply, or null when the update cannot be written.
 */
function planUsesEdits(file: UpdatedFile, update: ActionUpdate): Edit[] | null {
  let targetReference = update.targetRef ?? update.latestSha
  let targetReferenceStyle =
    update.targetRefStyle ?? (update.latestSha ? 'sha' : null)

  if (!targetReference || !targetReferenceStyle) {
    return null
  }

  let { name } = update.action

  if (name.includes('\n') || name.includes('\r')) {
    console.error(`Invalid action name: ${update.action.name}`)
    return null
  }

  let version = update.currentVersion ?? ''

  if (version.includes('\n') || version.includes('\r')) {
    console.error(`Invalid version: ${update.currentVersion}`)
    return null
  }

  if (
    targetReference.includes('\n') ||
    targetReference.includes('\r') ||
    targetReference.trim() === ''
  ) {
    console.error(`Invalid target ref: ${targetReference}`)
    return null
  }

  if (
    targetReferenceStyle === 'sha' &&
    !/^[\da-f]{40}$/iu.test(targetReference)
  ) {
    console.error(`Invalid SHA format: ${targetReference}`)
    return null
  }

  let { line } = update.action
  let reference = `${name}@`
  let edits: Edit[] = []

  for (let occurrence of file.occurrences) {
    let { value } = occurrence.node

    if (
      typeof value !== 'string' ||
      occurrence.key !== 'uses' ||
      file.claimed.has(occurrence.node) ||
      (line !== undefined && line > 0 && occurrence.keyLine !== line) ||
      (version ? value !== reference + version : !value.startsWith(reference))
    ) {
      continue
    }

    let valueEdit = renderValue(file.content, occurrence.node, {
      value: `${reference}${targetReference}`,
    })
    if (!valueEdit) {
      continue
    }

    file.claimed.add(occurrence.node)
    edits.push(
      valueEdit,
      planCommentEdit(file.content, occurrence.node, {
        latestVersion: update.latestVersion,
        sha: targetReferenceStyle === 'sha',
        hasVersion: version !== '',
      }),
    )
  }

  return edits.length > 0 ? edits : null
}

/**
 * Plan the rewrite of the comment that follows a `uses` value.
 *
 * A SHA target gets the version it pins as its comment, unless more of the step
 * follows on the line. A tag target keeps a comment that is not a version, and
 * drops one that is. A block scalar carries its comment on the line of its
 * indicator.
 *
 * @param content - File content.
 * @param node - Value being replaced.
 * @param target - Reference being written.
 * @param target.latestVersion - Version the SHA target pins, for its comment.
 * @param target.hasVersion - Whether the current reference names a version.
 * @param target.sha - Whether the target is a SHA.
 * @returns Edit of the text between the value and the end of its line.
 */
function planCommentEdit(
  content: string,
  node: Scalar,
  target: { latestVersion: string | null; hasVersion: boolean; sha: boolean },
): Edit {
  let start = commentAnchor(content, node)
  let lineBreak = content.indexOf('\n', start)
  let rest = content.slice(start, lineBreak === -1 ? content.length : lineBreak)
  let match = AFTER_VALUE.exec(rest)!
  let { comment: existingComment, after = '' } = match.groups!
  let hasTrailingContent = rest.slice(match[0].length).trim().length > 0
  let spacer = after.endsWith(' ') ? '' : ' '
  let comment = ''

  if (target.sha) {
    let skipComment =
      hasTrailingContent && !existingComment && target.hasVersion
    comment = skipComment ? '' : `${spacer}# ${target.latestVersion}`
  } else if (
    existingComment &&
    !looksLikeInlineVersionComment(existingComment)
  ) {
    comment = existingComment
  }

  /**
   * The whitespace that separated a dropped comment from the value would
   * otherwise be left dangling at the end of the line.
   */
  let kept = !comment && existingComment ? after.trimEnd() : after

  return { end: start + match[0].length, text: `${kept}${comment}`, start }
}

/**
 * Plan the replacement of a value in the style it is written in.
 *
 * A plain or quoted value is replaced as a whole token, keeping its quotes.
 * Within a block scalar (`>-`, `|-`) only the line holding the value is
 * replaced, so the indicator and the indentation stay. A value the style cannot
 * hold as it is, and a block scalar whose value spans several lines, are left
 * alone.
 *
 * @param content - File content.
 * @param node - Value to replace.
 * @param replacement - What to write.
 * @param replacement.value - New value.
 * @returns Edit replacing the value, or null when it cannot be replaced.
 */
function renderValue(
  content: string,
  node: Scalar,
  replacement: { value: string },
): Edit | null {
  let [start, end] = node.range!
  let { value } = replacement

  switch (node.type) {
    case 'QUOTE_DOUBLE':
      return value.includes('"') || value.includes('\\') ?
          null
        : { text: `"${value}"`, start, end }
    case 'QUOTE_SINGLE':
      return value.includes("'") ? null : { text: `'${value}'`, start, end }
    case 'PLAIN':
      return { text: value, start, end }
    default: {
      let source = content.slice(start, end)
      let bodyStart = source.indexOf('\n') + 1
      let current = String(node.value).trim()
      let offset = source.indexOf(current, bodyStart)

      if (
        offset === -1 ||
        current === '' ||
        current.includes('\n') ||
        source.includes(current, offset + 1)
      ) {
        return null
      }

      return {
        end: start + offset + current.length,
        start: start + offset,
        text: value,
      }
    }
  }
}

/**
 * Plan the rewrite of the `runs-on` label a runner update is about. Only the
 * label changes; its comment and the rest of the line stay as written.
 *
 * @param file - File being updated.
 * @param update - Runner update to write.
 * @returns Edits to apply, or null when the update cannot be written.
 */
function planRunnerEdits(
  file: UpdatedFile,
  update: ActionUpdate,
): Edit[] | null {
  let targetLabel = update.targetRef
  let currentLabel = update.currentVersion
  let { line } = update.action

  if (!targetLabel || !currentLabel || !line || line <= 0) {
    return null
  }

  if (!RUNNER_LABEL_VALUE.test(targetLabel)) {
    console.error(`Invalid runner label: ${targetLabel}`)
    return null
  }

  let occurrence = file.occurrences.find(
    candidate =>
      candidate.key === 'runs-on' &&
      candidate.keyLine === line &&
      candidate.node.value === currentLabel &&
      !file.claimed.has(candidate.node),
  )
  if (!occurrence) {
    return null
  }

  let edit = renderValue(file.content, occurrence.node, { value: targetLabel })
  if (!edit) {
    return null
  }

  file.claimed.add(occurrence.node)
  return [edit]
}

/**
 * Collect every `uses` and `runs-on` value of the file that is a scalar.
 *
 * An alias is not collected: the update belongs to the text where its anchor is
 * written, which is collected there.
 *
 * @param content - File content.
 * @returns Values in document order.
 */
function findOccurrences(content: string): Occurrence[] {
  let occurrences: Occurrence[] = []

  for (let document of parseAllDocuments(content)) {
    visit(document, {
      Pair(_key, pair) {
        if (!isScalar(pair.key) || !isScalar(pair.value)) {
          return
        }

        let { value: key } = pair.key
        if (key !== 'uses' && key !== 'runs-on') {
          return
        }

        occurrences.push({
          keyLine: getLineNumberForKey(content, pair.key),
          node: pair.value,
          key,
        })
      },
    })
  }

  return occurrences
}

/**
 * Rewrite the values the updates of one file are about.
 *
 * @param content - Text of the file as read.
 * @param fileUpdates - Updates whose entries the file holds.
 * @param unwritten - Collects the updates that cannot be written.
 * @returns Text of the file with the values rewritten.
 */
function applyFileUpdates(
  content: string,
  fileUpdates: ActionUpdate[],
  unwritten: Set<ActionUpdate>,
): string {
  let file: UpdatedFile = {
    occurrences: findOccurrences(content),
    claimed: new Set(),
    content,
  }
  let edits: Edit[] = []

  for (let update of fileUpdates) {
    let planned =
      update.action.type === 'runner' ?
        planRunnerEdits(file, update)
      : planUsesEdits(file, update)

    if (planned) {
      edits.push(...planned)
    } else {
      unwritten.add(update)
    }
  }

  return applyEdits(content, edits)
}

/**
 * Offset where the text that may hold the comment of a value begins.
 *
 * @param content - File content.
 * @param node - Value being replaced.
 * @returns End of a plain or quoted value, or end of the indicator of a block
 *   scalar.
 */
function commentAnchor(content: string, node: Scalar): number {
  let [start, end] = node.range!

  if (node.type !== 'BLOCK_FOLDED' && node.type !== 'BLOCK_LITERAL') {
    return end
  }

  let indicator = /^[>|][+\-1-9]*/u.exec(content.slice(start, end))!
  return start + indicator[0].length
}

/**
 * Splice the edits into the content from the last one to the first, so that
 * every offset still refers to the text it was computed on.
 *
 * @param content - File content.
 * @param edits - Planned edits; they never overlap.
 * @returns New content.
 */
function applyEdits(content: string, edits: Edit[]): string {
  let result = content
  let lastFirst = edits.toSorted((a, b) => b.start - a.start)

  for (let edit of lastFirst) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  }

  return result
}

function looksLikeInlineVersionComment(comment: string): boolean {
  return /^#\s*[Vv]?\d+(?:\.\d+){0,2}(?:[+-][\w\-.]+)?\s*$/u.test(
    comment.trim(),
  )
}
