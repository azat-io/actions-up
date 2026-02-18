import type { ScanResult } from '../types/scan-result'

/**
 * Merge multiple scan results into one.
 *
 * @param results - Array of scan results.
 * @returns Merged scan result.
 */
export function mergeScanResults(results: ScanResult[]): ScanResult {
  let merged: ScanResult = {
    compositeActions: new Map(),
    workflows: new Map(),
    actions: [],
  }
  for (let [index, result] of results.entries()) {
    for (let [key, value] of result.workflows) {
      merged.workflows.set(`${index}:${key}`, value)
    }
    for (let [, value] of result.compositeActions) {
      merged.compositeActions.set(`${index}:${value}`, value)
    }
    merged.actions.push(...result.actions)
  }

  /**
   * Deduplicate actions that appear in multiple scan results.
   */
  let seen = new Set<string>()
  merged.actions = merged.actions.filter(action => {
    let key = `${action.file}:${action.line}:${action.name}:${action.version}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })

  return merged
}
