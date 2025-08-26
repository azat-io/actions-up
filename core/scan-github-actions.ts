import { isAbsolute, relative, resolve, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'

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

  let normalizedRoot = resolve(rootPath)

  function isWithin(root: string, candidate: string): boolean {
    let relativePath = relative(root, candidate)
    return (
      relativePath !== '' &&
      !relativePath.startsWith('..') &&
      !isAbsolute(relativePath)
    )
  }

  let githubPath = join(normalizedRoot, GITHUB_DIRECTORY)

  if (!isWithin(normalizedRoot, githubPath)) {
    throw new Error('Invalid path: detected path traversal attempt')
  }

  /* Helper function to validate names for path traversal. */
  function isValidName(name: string): boolean {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      console.warn(`Skipping invalid name: ${name}`)
      return false
    }
    return true
  }

  /* Scan workflows. */
  let workflowsPath = join(githubPath, WORKFLOWS_DIRECTORY)

  if (!isWithin(normalizedRoot, workflowsPath)) {
    return result
  }

  try {
    let workflowsStat = await stat(workflowsPath)

    if (workflowsStat.isDirectory()) {
      let files = await readdir(workflowsPath)

      let workflowPromises = files
        .filter(file => {
          /** Validate filename to prevent traversal. */
          if (!isValidName(file)) {
            return false
          }
          return isYamlFile(file)
        })
        .map(async file => {
          let filePath = join(workflowsPath, file)

          if (!isWithin(workflowsPath, filePath)) {
            console.warn(`Skipping file outside workflows directory: ${file}`)
            return {
              success: false,
              actions: [],
              path: '',
            }
          }

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
        if (workflow.success && workflow.path) {
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
  let actionsPath = join(githubPath, ACTIONS_DIRECTORY)

  if (!isWithin(normalizedRoot, actionsPath)) {
    return result
  }

  try {
    let actionsStat = await stat(actionsPath)

    if (actionsStat.isDirectory()) {
      let subdirectories = await readdir(actionsPath)

      let actionPromises = subdirectories.map(async subdir => {
        /** Validate subdirectory name to prevent traversal. */
        if (!isValidName(subdir)) {
          return null
        }

        let subdirPath = join(actionsPath, subdir)

        /** Ensure subdirectory path is within the actions directory. */
        if (!isWithin(actionsPath, subdirPath)) {
          console.warn(`Skipping subdirectory outside actions path: ${subdir}`)
          return null
        }

        try {
          let subdirectoryStat = await stat(subdirPath)

          if (!subdirectoryStat.isDirectory()) {
            return null
          }

          let actionFilePath = join(subdirPath, 'action.yml')

          /** Validate action file path. */
          if (!isWithin(subdirPath, actionFilePath)) {
            return null
          }

          let actions: GitHubAction[] = []

          try {
            actions = await scanActionFile(actionFilePath)
          } catch {
            try {
              actionFilePath = join(subdirPath, 'action.yaml')

              /** Validate action file path for yaml variant. */
              if (!isWithin(subdirPath, actionFilePath)) {
                return null
              }

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
