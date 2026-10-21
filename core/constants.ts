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
