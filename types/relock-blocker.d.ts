/**
 * Why the workflow lockfiles that pin what a scanned file runs cannot all be
 * regenerated for it.
 *
 * - `unreadable`: this release cannot read one of them, or a workflow it tracks,
 *   or an action of the repository such a workflow runs, so the workflows that
 *   run the file are unknown.
 * - `unrecorded`: one of them does not record what the file runs under every
 *   workflow that runs it, as for an action a workflow runs only through `./`,
 *   which gh-actions-lock never follows, or one of those workflows runs remote
 *   actions through `./` alone, whose pins a relock of it may drop.
 * - `shared`: the lockfiles of more than one repository root pin it, as those of
 *   a repository and of one nested in it, or one lockfile found again through a
 *   symbolic link.
 */
export type RelockBlocker = 'unrecorded' | 'unreadable' | 'shared'
