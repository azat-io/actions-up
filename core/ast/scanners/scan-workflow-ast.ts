import type { Document } from 'yaml'

import type { GitHubAction } from '../../../types/github-action'

import { isWorkflowStructure } from '../../schema/workflow/is-workflow-structure'
import { parseActionReference } from '../../parsing/parse-action-reference'
import { extractUsesFromSteps } from '../utils/extract-uses-from-steps'
import { parseRunnerLabel } from '../../runners/parse-runner-label'
import { createNodeVisitor } from '../utils/create-node-visitor'
import { getLineNumberForKey } from '../utils/get-line-number'
import { recordValueLine } from '../utils/record-value-line'
import { findMapPair } from '../utils/find-map-pair'
import { isYAMLMap } from '../guards/is-yaml-map'
import { isScalar } from '../guards/is-scalar'
import { isPair } from '../guards/is-pair'
import { isNode } from '../guards/is-node'

/**
 * Scans a parsed workflow YAML document for action references.
 *
 * Navigates AST structure `jobs -> <job> -> steps` and extracts `uses` entries
 * with corresponding line numbers. Aliases along that path lead to their
 * anchors, and each anchored node is reported once, where it is written. Also
 * scans for job-level `uses` fields that indicate Reusable Workflows, and for
 * job-level `runs-on` labels that name a known GitHub-hosted runner image.
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

  let visit = createNodeVisitor(document)
  let jobs = visit(findMapPair(document.contents, 'jobs')?.value)
  if (!isYAMLMap(jobs)) {
    return []
  }

  let actions: GitHubAction[] = []

  for (let jobNode of jobs.items) {
    if (!isPair(jobNode)) {
      continue
    }

    let job = visit(jobNode.value)
    if (!isNode(job) || !isYAMLMap(job)) {
      continue
    }

    let jobName = isScalar(jobNode.key) ? String(jobNode.key.value) : undefined

    /**
     * Check for Reusable Workflows.
     */
    let usesPair = findMapPair(job, 'uses')
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
        recordValueLine(action, { node: usesPair.value, content })
        actions.push(action)
      }
    }

    /**
     * Check for GitHub-hosted runner labels.
     *
     * Only a plain scalar is considered. Sequences (`[self-hosted, linux]`),
     * the `{ group, labels }` form, expressions and floating aliases carry no
     * single image version to compare against, so they are left alone. A label
     * written anywhere a scalar can be, quoted, anchored, in a flow mapping or
     * on the next line, is found and rewritten in place.
     */
    let runsOnPair = findMapPair(job, 'runs-on')
    if (runsOnPair?.value && runsOnPair.key && isScalar(runsOnPair.value)) {
      let label = String(runsOnPair.value.value)
      let parsed = parseRunnerLabel(label)
      if (parsed) {
        let runner: GitHubAction = {
          line: getLineNumberForKey(content, runsOnPair.key),
          name: `runner/${parsed.family}`,
          type: 'runner',
          version: label,
          file: filePath,
        }
        if (jobName) {
          runner.job = jobName
        }
        recordValueLine(runner, { node: runsOnPair.value, content })
        actions.push(runner)
      }
    }

    let stepsPair = findMapPair(job, 'steps')
    if (!stepsPair?.value) {
      continue
    }

    actions.push(
      ...extractUsesFromSteps({
        stepsNode: stepsPair.value,
        filePath,
        content,
        jobName,
        visit,
      }),
    )
  }

  return actions
}
