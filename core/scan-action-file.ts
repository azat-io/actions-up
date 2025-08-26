import type { GitHubAction } from '../types/github-action'

import { scanCompositeActionAst } from './ast/scanners/scan-composite-action-ast'
import { readYamlDocument } from './fs/read-yaml-document'

/**
 * Scans a composite GitHub Action file (action.yml or action.yaml) for all
 * action references.
 *
 * @param filePath - The path to the action YAML file to scan.
 * @returns A promise that resolves to an array of GitHubAction objects found in
 *   the action file.
 */
export async function scanActionFile(
  filePath: string,
): Promise<GitHubAction[]> {
  let { document, content } = await readYamlDocument(filePath)
  return scanCompositeActionAst(document, content, filePath)
}
