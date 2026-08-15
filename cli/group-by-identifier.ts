/**
 * Groups blocked or skipped updates by their display identifier, preserving the
 * order of first appearance and counting how many places reference each one.
 *
 * @param updates - Array of updates with their actions and current versions.
 * @returns Array of unique identifiers with occurrence counts.
 */
export function groupByIdentifier(
  updates: {
    action: { version?: string | null; uses?: string; name: string }
    currentVersion: string | null
  }[],
): { identifier: string; count: number }[] {
  let counts = new Map<string, number>()

  for (let update of updates) {
    let identifier =
      update.action.uses ??
      `${update.action.name}@${update.currentVersion ?? 'unknown'}`
    counts.set(identifier, (counts.get(identifier) ?? 0) + 1)
  }

  return [...counts].map(([identifier, count]) => ({ identifier, count }))
}
