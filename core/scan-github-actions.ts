import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { GitHubAction } from '../types/github-action'
import type { ScanResult } from '../types/scan-result'

import {
  WORKFLOWS_DIRECTORY,
  ACTIONS_DIRECTORY,
  GITHUB_DIRECTORY,
} from './constants'
import { scanWorkflowFile } from './scan-workflow-file'
import { scanActionFile } from './scan-action-file'
import { isYamlFile } from './fs/is-yaml-file'

/**
 * Scans a repository for all GitHub Actions usage in workflows and composite
 * actions.
 *
 * @example
 *   const result = await scanGitHubActions('/path/to/repo')
 *
 * @param rootPath - The root path of the repository to scan. Defaults to
 *   current working directory.
 * @returns A promise that resolves to a ScanResult containing:
 *
 *   - Workflows: Map of workflow file paths to their referenced actions
 *   - CompositeActions: Map of composite action names to their directory paths
 *   - Actions: Flat array of all discovered GitHub Actions.
 */
export async function scanGitHubActions(
  rootPath: string = process.cwd(),
): Promise<ScanResult> {
  let result: ScanResult = {
    compositeActions: new Map(),
    workflows: new Map(),
    actions: [],
  }

  let githubPath = join(rootPath, GITHUB_DIRECTORY)

  /* Check if .github exists. */
  try {
    await stat(githubPath)
  } catch {
    return result
  }

  /* Scan workflows. */
  let workflowsPath = join(githubPath, WORKFLOWS_DIRECTORY)
  try {
    let workflowsStat = await stat(workflowsPath)

    if (workflowsStat.isDirectory()) {
      let files = await readdir(workflowsPath)

      let workflowPromises = files
        .filter(file => isYamlFile(file))
        .map(async file => {
          let filePath = join(workflowsPath, file)

          try {
            let actions = await scanWorkflowFile(filePath)
            return {
              path: `${GITHUB_DIRECTORY}/${WORKFLOWS_DIRECTORY}/${file}`,
              success: true,
              actions,
            }
          } catch {
            return {
              path: `${GITHUB_DIRECTORY}/${WORKFLOWS_DIRECTORY}/${file}`,
              success: false,
              actions: [],
            }
          }
        })

      let workflowResults = await Promise.all(workflowPromises)

      /* Only add successfully scanned workflows to results. */
      for (let workflow of workflowResults) {
        if (workflow.success) {
          if (workflow.actions.length > 0) {
            result.workflows.set(workflow.path, workflow.actions)
            result.actions.push(...workflow.actions)
          } else {
            /* Add workflow even if no actions found. */
            result.workflows.set(workflow.path, [])
          }
        }
      }
    }
  } catch {
    /* Workflows directory not found or inaccessible. */
  }

  /* Scan composite actions. */
  let actionsPath = join(githubPath, 'actions')
  try {
    let actionsStat = await stat(actionsPath)

    if (actionsStat.isDirectory()) {
      let subdirectories = await readdir(actionsPath)

      let actionPromises = subdirectories.map(async subdir => {
        let subdirPath = join(actionsPath, subdir)

        try {
          let subdirectoryStat = await stat(subdirPath)

          if (!subdirectoryStat.isDirectory()) {
            return null
          }

          let actionFilePath = join(subdirPath, 'action.yml')
          let actions: GitHubAction[] = []

          try {
            actions = await scanActionFile(actionFilePath)
          } catch {
            try {
              actionFilePath = join(subdirPath, 'action.yaml')
              actions = await scanActionFile(actionFilePath)
            } catch {
              return null
            }
          }

          return {
            path: `${GITHUB_DIRECTORY}/${ACTIONS_DIRECTORY}/${subdir}`,
            name: subdir,
            actions,
          }
        } catch {
          return null
        }
      })

      let actionResults = await Promise.all(actionPromises)

      for (let actionResult of actionResults) {
        if (actionResult) {
          result.compositeActions.set(actionResult.name, actionResult.path)
          result.actions.push(...actionResult.actions)
        }
      }
    }
  } catch {
    /* Actions directory not found or inaccessible. */
  }

  return result
}
