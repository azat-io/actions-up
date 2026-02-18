import { isAbsolute, relative, resolve, join } from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'

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
 *
 * ```ts
 * const result = await scanGitHubActions('/path/to/repo')
 * ```
 *
 * @param rootPath - The root path of the repository to scan. Defaults to
 *   current working directory.
 * @param ciDirectory - The CI directory name (e.g., '.github' or '.gitea').
 *   Defaults to '.github'.
 * @returns A promise that resolves to a ScanResult containing:
 *
 *   - Workflows: Map of workflow file paths to their referenced actions
 *   - CompositeActions: Map of composite action names to their directory paths
 *   - Actions: Flat array of all discovered GitHub Actions.
 */
export async function scanGitHubActions(
  rootPath: string = process.cwd(),
  ciDirectory: string = GITHUB_DIRECTORY,
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

  let githubPath = join(normalizedRoot, ciDirectory)

  /**
   * Helper function to validate names for path traversal.
   *
   * @param name - The name to validate.
   * @returns True if the name is valid, false otherwise.
   */
  function isValidName(name: string): boolean {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      console.warn(`Skipping invalid name: ${name}`)
      return false
    }
    return true
  }

  /**
   * Check if path is a file.
   *
   * @param path - The file path to check.
   * @returns True if the path is a file, false otherwise.
   */
  async function isFile(path: string): Promise<boolean> {
    try {
      let info = await stat(path)
      return typeof info.isFile === 'function' ? info.isFile() : false
    } catch {
      return false
    }
  }

  /**
   * Scan workflows.
   */
  let workflowsPath = join(githubPath, WORKFLOWS_DIRECTORY)

  try {
    let workflowsStat = await stat(workflowsPath)

    if (workflowsStat.isDirectory()) {
      let files = await readdir(workflowsPath)

      let workflowPromises = files
        .filter(file => {
          /**
           * Validate filename to prevent traversal.
           */
          if (!isValidName(file)) {
            return false
          }
          return isYamlFile(file)
        })
        .map(async file => {
          let filePath = join(workflowsPath, file)

          try {
            let actions = await scanWorkflowFile(filePath)
            return {
              path: `${ciDirectory}/${WORKFLOWS_DIRECTORY}/${file}`,
              success: true,
              actions,
            }
          } catch {
            return {
              path: `${ciDirectory}/${WORKFLOWS_DIRECTORY}/${file}`,
              success: false,
              actions: [],
            }
          }
        })

      let workflowResults = await Promise.all(workflowPromises)

      /**
       * Only add successfully scanned workflows to results.
       */
      for (let workflow of workflowResults) {
        if (workflow.success && workflow.path) {
          if (workflow.actions.length > 0) {
            result.workflows.set(workflow.path, workflow.actions)
            result.actions.push(...workflow.actions)
          } else {
            /**
             * Add workflow even if no actions found.
             */
            result.workflows.set(workflow.path, [])
          }
        }
      }
    }
  } catch {
    /**
     * Workflows directory not found or inaccessible.
     */
  }

  /**
   * Scan root action.yml/action.yaml for composite actions.
   */
  try {
    let rootActionYml = join(normalizedRoot, 'action.yml')
    let rootActionYaml = join(normalizedRoot, 'action.yaml')
    let rootActionFile: string | null = null
    let actions: GitHubAction[] = []

    if (await isFile(rootActionYml)) {
      try {
        actions = await scanActionFile(rootActionYml)
        rootActionFile = rootActionYml
      } catch {
        rootActionFile = null
      }
    }

    if (!rootActionFile && (await isFile(rootActionYaml))) {
      try {
        actions = await scanActionFile(rootActionYaml)
        rootActionFile = rootActionYaml
      } catch {
        rootActionFile = null
      }
    }

    if (rootActionFile) {
      let relativePath = relative(normalizedRoot, rootActionFile)
      result.compositeActions.set(relativePath, relativePath)
      if (actions.length > 0) {
        result.actions.push(...actions)
      }
    }
  } catch {
    /**
     * Root action file not found or unreadable.
     */
  }

  /**
   * Scan composite actions.
   */
  let actionsPath = join(githubPath, ACTIONS_DIRECTORY)

  try {
    let actionsStat = await stat(actionsPath)

    if (actionsStat.isDirectory()) {
      let subdirectories = await readdir(actionsPath)

      let actionPromises = subdirectories.map(async subdir => {
        /**
         * Validate subdirectory name to prevent traversal.
         */
        if (!isValidName(subdir)) {
          return null
        }

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
            path: `${ciDirectory}/${ACTIONS_DIRECTORY}/${subdir}`,
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
    /**
     * Actions directory not found or inaccessible.
     */
  }

  /**
   * Follow same-repo external composite actions with path, e.g.
   * Owner/repo/path@ref where owner/repo matches the current repository. We
   * resolve `path` to a local directory and scan its action.yml(yaml) for
   * nested uses.
   */
  try {
    let repoSlug = await getCurrentRepoSlug(normalizedRoot)

    if (repoSlug) {
      /**
       * Test-only branch to exercise outer catch during coverage runs.
       */
      if (process.env['ACTIONS_UP_TEST_THROW'] === '1') {
        throw new Error('test')
      }

      let seenCompositeDirectories = new Set<string>()

      /**
       * Seed queue with composite paths referenced in discovered actions.
       */
      let queue: string[] = []

      for (let action of result.actions) {
        if (action.type !== 'external') {
          continue
        }
        let segs = action.name.split('/')
        if (segs.length < 3) {
          continue
        }
        let candidateSlug = `${segs[0]}/${segs[1]}`
        if (candidateSlug !== repoSlug) {
          continue
        }

        let compositeDirectory = join(normalizedRoot, ...segs.slice(2))
        if (!isWithin(normalizedRoot, compositeDirectory)) {
          continue
        }
        if (seenCompositeDirectories.has(compositeDirectory)) {
          continue
        }
        seenCompositeDirectories.add(compositeDirectory)
        queue.push(compositeDirectory)
      }

      /**
       * Breadth-first follow to collect nested actions without awaiting inside
       * loops.
       */
      async function processQueue(): Promise<void> {
        if (queue.length === 0) {
          return
        }

        let batch = queue.splice(0)
        let discoveredNext = await Promise.all(
          batch.map(async directory => {
            try {
              let ymlPath = join(directory, 'action.yml')
              let yamlPath = join(directory, 'action.yaml')

              let filePath = ymlPath
              try {
                let fileInfo = await stat(ymlPath)
                if (!fileInfo.isFile()) {
                  throw new Error('not a file')
                }
              } catch {
                let yamlInfo = await stat(yamlPath)
                if (!yamlInfo.isFile()) {
                  throw new Error('not a file')
                }
                filePath = yamlPath
              }

              let nestedActions = await scanActionFile(filePath)
              if (nestedActions.length > 0) {
                result.actions.push(...nestedActions)
              }

              let nextDirectories: string[] = []
              for (let nestedAction of nestedActions) {
                if (nestedAction.type !== 'external') {
                  continue
                }
                let nameSegments = nestedAction.name.split('/')
                if (nameSegments.length < 3) {
                  continue
                }
                let nameSlug = `${nameSegments[0]}/${nameSegments[1]}`
                if (nameSlug !== repoSlug) {
                  continue
                }
                let nextDirectory = join(
                  normalizedRoot,
                  ...nameSegments.slice(2),
                )
                if (!isWithin(normalizedRoot, nextDirectory)) {
                  continue
                }
                if (seenCompositeDirectories.has(nextDirectory)) {
                  continue
                }
                seenCompositeDirectories.add(nextDirectory)
                nextDirectories.push(nextDirectory)
              }
              return nextDirectories
            } catch {
              return [] as string[]
            }
          }),
        )

        for (let list of discoveredNext) {
          for (let directory of list) {
            queue.push(directory)
          }
        }

        await processQueue()
      }

      await processQueue()
    }
  } catch {
    /**
     * Ignore repo detection errors.
     */
  }

  return result
}

/**
 * Get current repository slug in form "owner/repo". Prefers GITHUB_REPOSITORY,
 * falls back to parsing .git/config remotes.
 *
 * @param root - Absolute repository root directory.
 * @returns Repository slug in form "owner/repo" or null when not detected.
 */
async function getCurrentRepoSlug(root: string): Promise<string | null> {
  let environmentSlug = process.env['GITHUB_REPOSITORY']
  if (environmentSlug && /^[^\s/]+\/[^\s/]+$/u.test(environmentSlug)) {
    return environmentSlug
  }

  try {
    let gitConfigPath = join(root, '.git', 'config')
    let content = await readFile(gitConfigPath, 'utf8')

    /**
     * Prefer origin, fallback to first URL.
     */
    let originUrlMatch = content.match(
      /\[remote "origin"\][\s\S]*?url\s*=\s*(?<url>.+)/u,
    )
    let url = originUrlMatch?.groups?.['url']?.trim()
    if (!url) {
      let anyUrlMatch = content.match(/url\s*=\s*(?<url>.+)/u)
      url = anyUrlMatch?.groups?.['url']?.trim()
    }
    if (!url) {
      return null
    }

    /**
     * Extract owner/repo from common GitHub URL forms.
     */
    // https://github.com/owner/repo(.git)?
    let httpsMatch = url.match(
      /github\.com[/:](?<owner>[^/]+)\/(?<repo>[^./]+)(?:\.git)?$/u,
    )
    if (httpsMatch?.groups) {
      return `${httpsMatch.groups['owner']}/${httpsMatch.groups['repo']}`
    }
  } catch {
    /**
     * No git config or unreadable.
     */
  }
  return null
}
