import type { Document } from 'yaml'

import type { GitHubAction } from '../../../types/github-action'

import { isCompositeActionStructure } from '../../schema/composite/is-composite-action-structure'
import { isCompositeActionRuns } from '../../schema/composite/is-composite-action-runs'
import { extractUsesFromSteps } from '../utils/extract-uses-from-steps'
import { createNodeVisitor } from '../utils/create-node-visitor'
import { findMapPair } from '../utils/find-map-pair'
import { isYAMLMap } from '../guards/is-yaml-map'

/**
 * Scans a parsed composite action YAML document for action references.
 *
 * Navigates AST structure `runs -> steps` and extracts `uses` entries with
 * corresponding line numbers when the action defines `using: composite`.
 * Aliases along that path lead to their anchors, and each anchored node is
 * reported once, where it is written.
 *
 * @param document - Parsed YAML document of a composite action file.
 * @param content - Original file content.
 * @param filePath - Path of the action file.
 * @returns List of discovered actions.
 */

export function scanCompositeActionAst(
  document: Document,
  content: string,
  filePath: string,
): GitHubAction[] {
  let action = document.toJSON() as unknown

  if (!isCompositeActionStructure(action)) {
    return []
  }

  if (!document.contents || !isYAMLMap(document.contents)) {
    return []
  }

  let visit = createNodeVisitor(document)
  let runs = visit(findMapPair(document.contents, 'runs')?.value)

  if (!isYAMLMap(runs)) {
    return []
  }

  let runsJson = (action as Record<string, unknown>)['runs']

  if (
    !runsJson ||
    !isCompositeActionRuns(runsJson) ||
    !(runsJson as Record<string, unknown>)['steps'] ||
    !Array.isArray((runsJson as Record<string, unknown>)['steps'])
  ) {
    return []
  }

  let stepsPair = findMapPair(runs, 'steps')

  if (!stepsPair?.value) {
    return []
  }

  return extractUsesFromSteps({
    stepsNode: stepsPair.value,
    filePath,
    content,
    visit,
  })
}
