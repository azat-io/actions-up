/**
 * Whether gh-actions-lock, the GitHub CLI extension that regenerates workflow
 * lockfiles, can be run, and why not when it cannot:
 *
 * - `available`: it can be run.
 * - `no-gh`: the GitHub CLI is not installed.
 * - `unauthenticated`: the GitHub CLI has no credentials, so it runs no command,
 *   not even the list of installed extensions.
 * - `unlisted`: the list of installed extensions did not finish, or `gh` could
 *   not be started for a reason other than being missing, so the extension was
 *   not looked for.
 * - `missing`: it is not installed, or the list of extensions failed, as with the
 *   GitHub CLI before 2.10 when no extension is installed.
 * - `outdated`: its release is older than the relock needs.
 */
export type LockTool =
  | 'unauthenticated'
  | 'available'
  | 'unlisted'
  | 'outdated'
  | 'missing'
  | 'no-gh'
