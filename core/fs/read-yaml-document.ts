import type { Document } from 'yaml'

import { readFile } from 'node:fs/promises'
import { parseDocument } from 'yaml'

/**
 * Reads a YAML file and returns both its raw content and parsed Document.
 *
 * @param filePath - Path to the YAML file.
 * @returns Parsed YAML document along with original content.
 */
export async function readYamlDocument(
  filePath: string,
): Promise<{ document: Document; content: string }> {
  let content = await readFile(filePath, 'utf8')
  let document: Document = parseDocument(content)
  return { document, content }
}
