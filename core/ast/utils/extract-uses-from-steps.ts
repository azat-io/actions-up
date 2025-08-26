import type { Pair } from 'yaml'

import type { GitHubAction } from '../../../types/github-action'

import { parseActionReference } from '../../parsing/parse-action-reference'
import { isYAMLSequence } from '../guards/is-yaml-sequence'
import { getLineNumberForKey } from './get-line-number'
import { isYAMLMap } from '../guards/is-yaml-map'
import { isScalar } from '../guards/is-scalar'
import { isNode } from '../guards/is-node'
import { isPair } from '../guards/is-pair'

/**
 * Extracts GitHub Action references from a steps YAML sequence.
 *
 * Uses the AST to locate the 'uses' key for precise line numbers and the JSON
 * representation to validate the presence and type of the 'uses' field.
 *
 * @param stepsNode - YAML sequence node containing workflow/action steps.
 * @param filePath - Path of the file being scanned (for metadata).
 * @param content - Original YAML file content (for line number calculation).
 * @returns List of discovered GitHub actions.
 */
export function extractUsesFromSteps(
  stepsNode: unknown,
  filePath: string,
  content: string,
): GitHubAction[] {
  if (!isYAMLSequence(stepsNode)) {
    return []
  }

  let actions: GitHubAction[] = []

  for (let stepNode of stepsNode.items) {
    if (!isYAMLMap(stepNode) || !isNode(stepNode)) {
      continue
    }

    let step = stepNode.toJSON() as unknown
    if (step === null || typeof step !== 'object' || Array.isArray(step)) {
      continue
    }

    let stepObject = step as Record<string, unknown>
    if (typeof stepObject['uses'] !== 'string') {
      continue
    }

    let usesPair = stepNode.items.find(
      (item): item is Pair =>
        isPair(item) && isScalar(item.key) && item.key.value === 'uses',
    )

    let lineNumber = usesPair?.key
      ? getLineNumberForKey(content, usesPair.key)
      : 0
    let action = parseActionReference(stepObject['uses'], filePath, lineNumber)
    if (action) {
      actions.push(action)
    }
  }

  return actions
}
