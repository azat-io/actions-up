/**
 * Constants for directory names used in the project.
 */

export const GITHUB_DIRECTORY = '.github' as const

export const WORKFLOWS_DIRECTORY = 'workflows' as const

export const ACTIONS_DIRECTORY = 'actions' as const

export const LOCKFILE_NAME = 'actions.lock' as const

/**
 * Names of the file that defines an action, in the order the runner looks for
 * them.
 */
export const ACTION_MANIFESTS: readonly string[] = ['action.yml', 'action.yaml']

/**
 * Signals that stop the CLI from a terminal or a supervisor.
 */
export const STOP_SIGNALS = ['SIGINT', 'SIGTERM'] as const

/**
 * Exit codes shells report for a process that a stop signal ended.
 */
export const SIGNAL_EXIT_CODES: Readonly<
  Record<(typeof STOP_SIGNALS)[number], number>
> = { SIGTERM: 143, SIGINT: 130 }

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
 * Oldest release of gh-actions-lock the relock works with: the oldest one whose
 * own `--verify` accepts the lockfile after a relock of some of its workflows.
 * Release 0.4.1 stopped dropping an action a composite action runs when the
 * lockfile names its repository in another case. Release 0.5.0 stopped dropping
 * the `uses` edge of a composite action to an action the workflow also runs
 * directly, and stopped keeping a reference the workflow no longer runs itself
 * among its pins when a composite action still runs it. Since 0.5.0,
 * `--migrate-local-actions` rewrites workflows alone, where earlier releases
 * rewrote action files too.
 */
export const MIN_LOCK_TOOL_VERSION = '0.5.0' as const
