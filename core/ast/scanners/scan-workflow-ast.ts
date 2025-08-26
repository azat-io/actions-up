import type { Document } from 'yaml'

import type { GitHubAction } from '../../../types/github-action'

import { isWorkflowStructure } from '../../schema/workflow/is-workflow-structure'
import { extractUsesFromSteps } from '../utils/extract-uses-from-steps'
import { findMapPair } from '../utils/find-map-pair'
import { isYAMLMap } from '../guards/is-yaml-map'
import { isPair } from '../guards/is-pair'
import { isNode } from '../guards/is-node'

/**
 * Scans a parsed workflow YAML document for action references.
 *
 * Navigates AST structure `jobs -> <job> -> steps` and extracts `uses` entries
 * with corresponding line numbers.
 *
 * @param document - Parsed YAML document of a workflow file.
 * @param content - Original file content.
 * @param filePath - Path of the workflow file to scan.
 * @returns List of discovered actions.
 */
export function scanWorkflowAst(
  document: Document,
  content: string,
  filePath: string,
): GitHubAction[] {
  let workflow = document.toJSON() as unknown
  if (!isWorkflowStructure(workflow)) {
    return []
  }

  if (!document.contents || !isYAMLMap(document.contents)) {
    return []
  }

  let jobsPair = findMapPair(document.contents, 'jobs')
  if (!jobsPair?.value || !isYAMLMap(jobsPair.value)) {
    return []
  }

  let actions: GitHubAction[] = []

  for (let jobNode of jobsPair.value.items) {
    if (!isPair(jobNode) || !jobNode.value || !isNode(jobNode.value)) {
      continue
    }
    if (!isYAMLMap(jobNode.value)) {
      continue
    }

    let stepsPair = findMapPair(jobNode.value, 'steps')
    if (!stepsPair?.value) {
      continue
    }

    actions.push(...extractUsesFromSteps(stepsPair.value, filePath, content))
  }

  return actions
}
