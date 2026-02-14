import { isAbsolute, relative, dirname, resolve } from 'node:path'

import type { ScanResult } from '../types/scan-result'

import { isCompositeActionStructure } from './schema/composite/is-composite-action-structure'
import { scanCompositeActionAst } from './ast/scanners/scan-composite-action-ast'
import { isWorkflowStructure } from './schema/workflow/is-workflow-structure'
import { findYamlFilesRecursive } from './fs/find-yaml-files-recursive'
import { scanWorkflowAst } from './ast/scanners/scan-workflow-ast'
import { readYamlDocument } from './fs/read-yaml-document'

/**
 * Recursively scans a directory for all YAML files and classifies them as
 * workflows or composite actions.
 *
 * @param rootPath - The root path of the repository.
 * @param directory - The directory to scan recursively, relative to rootPath.
 * @returns A promise that resolves to a ScanResult.
 */
export async function scanRecursive(
  rootPath: string,
  directory: string,
): Promise<ScanResult> {
  let result: ScanResult = {
    compositeActions: new Map(),
    workflows: new Map(),
    actions: [],
  }

  let normalizedRoot = resolve(rootPath)
  let targetPath = resolve(normalizedRoot, directory)

  let relativePath = relative(normalizedRoot, targetPath)
  if (
    relativePath !== '' &&
    (relativePath.startsWith('..') || isAbsolute(relativePath))
  ) {
    throw new Error('Invalid path: detected path traversal attempt')
  }

  let yamlFiles: string[]
  try {
    yamlFiles = await findYamlFilesRecursive(targetPath)
  } catch {
    return result
  }

  let scanPromises = yamlFiles.map(async filePath => {
    let relativeFilePath = relative(normalizedRoot, filePath)

    try {
      let { document, content } = await readYamlDocument(filePath)
      let json = document.toJSON() as unknown

      if (isWorkflowStructure(json) && hasKey(json, 'jobs')) {
        let actions = scanWorkflowAst(document, content, filePath)
        return { type: 'workflow' as const, path: relativeFilePath, actions }
      }

      if (isCompositeActionStructure(json) && hasKey(json, 'runs')) {
        let actions = scanCompositeActionAst(document, content, filePath)
        return { type: 'action' as const, path: relativeFilePath, actions }
      }
    } catch {
      /** Unreadable or unparsable file, skip. */
    }

    return null
  })

  let scanResults = await Promise.all(scanPromises)

  for (let scanResult of scanResults) {
    if (!scanResult) {
      continue
    }

    if (scanResult.type === 'workflow') {
      result.workflows.set(scanResult.path, scanResult.actions)
      result.actions.push(...scanResult.actions)
    } else {
      let actionDirectory = dirname(scanResult.path)
      let actionName =
        actionDirectory === '.' || actionDirectory === ''
          ? scanResult.path
          : actionDirectory
      result.compositeActions.set(actionName, scanResult.path)
      result.actions.push(...scanResult.actions)
    }
  }

  return result
}

/**
 * Check if an object has a specific key.
 *
 * @param value - The value to check.
 * @param key - The key to look for.
 * @returns True if the value has the key.
 */
function hasKey(value: unknown, key: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    key in (value as Record<string, unknown>)
  )
}
