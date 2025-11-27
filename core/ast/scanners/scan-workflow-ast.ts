import type { Document } from 'yaml'

import type { GitHubAction } from '../../../types/github-action'

import { isWorkflowStructure } from '../../schema/workflow/is-workflow-structure'
import { parseActionReference } from '../../parsing/parse-action-reference'
import { extractUsesFromSteps } from '../utils/extract-uses-from-steps'
import { getLineNumberForKey } from '../utils/get-line-number'
import { findMapPair } from '../utils/find-map-pair'
import { isYAMLMap } from '../guards/is-yaml-map'
import { isScalar } from '../guards/is-scalar'
import { isPair } from '../guards/is-pair'
import { isNode } from '../guards/is-node'

/**
 * Scans a parsed workflow YAML document for action references.
 *
 * Navigates AST structure `jobs -> <job> -> steps` and extracts `uses` entries
 * with corresponding line numbers. Also scans for job-level `uses` fields that
 * indicate Reusable Workflows.
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

    /** Check for Reusable Workflows. */
    let usesPair = findMapPair(jobNode.value, 'uses')
    if (usesPair?.value && usesPair.key && isScalar(usesPair.value)) {
      let usesValue = String(usesPair.value.value)
      let lineNumber = getLineNumberForKey(content, usesPair.key)
      let action = parseActionReference(usesValue, filePath, lineNumber)
      if (action) {
        actions.push(action)
      }
    }

    /** Check for Github Actions. */
    let stepsPair = findMapPair(jobNode.value, 'steps')
    if (stepsPair?.value) {
      actions.push(...extractUsesFromSteps(stepsPair.value, filePath, content))
    }
  }

  return actions
}
