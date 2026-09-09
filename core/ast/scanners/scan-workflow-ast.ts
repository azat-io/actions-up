import type { Document } from 'yaml'

import type { GitHubAction } from '../../../types/github-action'

import { isWorkflowStructure } from '../../schema/workflow/is-workflow-structure'
import { parseActionReference } from '../../parsing/parse-action-reference'
import { buildRunsOnPattern, getLine } from '../../runners/runs-on-line'
import { extractUsesFromSteps } from '../utils/extract-uses-from-steps'
import { parseRunnerLabel } from '../../runners/parse-runner-label'
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
 * indicate Reusable Workflows, and for job-level `runs-on` labels that name a
 * known GitHub-hosted runner image.
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

    let jobName = isScalar(jobNode.key) ? String(jobNode.key.value) : undefined

    /**
     * Check for Reusable Workflows.
     */
    let usesPair = findMapPair(jobNode.value, 'uses')
    if (usesPair?.value && usesPair.key && isScalar(usesPair.value)) {
      let usesValue = String(usesPair.value.value)
      let lineNumber = getLineNumberForKey(content, usesPair.key)
      let action = parseActionReference(usesValue, filePath, lineNumber)
      if (action) {
        if (jobName) {
          action.job = jobName
        }
        if (usesPair.value.comment) {
          action.comment = usesPair.value.comment
        }
        actions.push(action)
      }
    }

    /**
     * Check for GitHub-hosted runner labels.
     *
     * Only a plain scalar is considered. Sequences (`[self-hosted, linux]`),
     * the `{ group, labels }` form, expressions and floating aliases carry no
     * single image version to compare against, so they are left alone.
     *
     * The source line is matched against the very pattern the writer uses, so a
     * form the writer cannot rewrite — an anchored value, a value carried to
     * the next line, a key inside a flow mapping — is never offered as an
     * update that would then silently do nothing.
     */
    let runsOnPair = findMapPair(jobNode.value, 'runs-on')
    if (runsOnPair?.value && runsOnPair.key && isScalar(runsOnPair.value)) {
      let label = String(runsOnPair.value.value)
      let parsed = parseRunnerLabel(label)
      let lineNumber = getLineNumberForKey(content, runsOnPair.key)
      let line = getLine(content, lineNumber)
      if (parsed && line !== null && buildRunsOnPattern(label).test(line)) {
        let runner: GitHubAction = {
          name: `runner/${parsed.family}`,
          line: lineNumber,
          type: 'runner',
          version: label,
          file: filePath,
        }
        if (jobName) {
          runner.job = jobName
        }
        actions.push(runner)
      }
    }

    let stepsPair = findMapPair(jobNode.value, 'steps')
    if (!stepsPair?.value) {
      continue
    }

    actions.push(
      ...extractUsesFromSteps({
        stepsNode: stepsPair.value,
        filePath,
        content,
        jobName,
      }),
    )
  }

  return actions
}
