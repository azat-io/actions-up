import type { GitHubAction } from '../types/github-action'

import { scanWorkflowAst } from './ast/scanners/scan-workflow-ast'
import { readYamlDocument } from './fs/read-yaml-document'

/**
 * Scans a GitHub workflow file for all action references.
 *
 * @param filePath - The path to the workflow YAML file to scan.
 * @returns A promise that resolves to an array of GitHubAction objects found in
 *   the workflow.
 */
export async function scanWorkflowFile(
  filePath: string,
): Promise<GitHubAction[]> {
  let { document, content } = await readYamlDocument(filePath)
  return scanWorkflowAst(document, content, filePath)
}
