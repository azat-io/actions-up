/**
 * Constants for directory names used in the project.
 */

export const GITHUB_DIRECTORY = '.github' as const

export const WORKFLOWS_DIRECTORY = 'workflows' as const

export const ACTIONS_DIRECTORY = 'actions' as const

export const LOCKFILE_NAME = 'actions.lock' as const

/**
 * Schema versions of the workflow lockfile this release reads. The format is
 * still before 1.0 and may change, so a file in any other version is not read
 * but treated as unreadable.
 */
export const SUPPORTED_LOCKFILE_VERSIONS: ReadonlySet<string> = new Set([
  'v0.0.2',
  'v0.0.3',
])

/**
 * Oldest release of gh-actions-lock the relock works with. It made a `./`
 * action that runs remote actions block a run, together with the other behavior
 * the relock relies on: a run that blocks writes nothing, `./` references are
 * rewritten only on request, and the JSON of a run that wrote reports what it
 * pinned.
 */
export const MIN_LOCK_TOOL_VERSION = '0.3.0' as const
