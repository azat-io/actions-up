/**
 * Checks if a file is a YAML file.
 *
 * @param filePath - The path to the file.
 * @returns True if the file is a YAML file, false otherwise.
 */
export function isYamlFile(filePath: string): boolean {
  return filePath.endsWith('.yml') || filePath.endsWith('.yaml')
}
