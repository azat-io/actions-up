/**
 * Why the workflow lockfiles that pin what a scanned file runs cannot all be
 * regenerated for it.
 *
 * - `unreadable`: this release cannot read one of them, or a workflow it tracks,
 *   or an action of the repository such a workflow runs, so the workflows that
 *   run the file are unknown.
 * - `unrecorded`: one of them does not record what the file runs under every
 *   workflow that runs it, or everything one of those workflows runs, so that a
 *   relock may drop pins they still need: gh-actions-lock never follows `./`,
 *   and refuses to relock a workflow that runs remote actions through it, even
 *   through an action the workflow also runs through `$/`, nor does it read the
 *   steps of a composite action whose kind is not written in lower case.
 * - `shared`: the lockfiles of more than one repository root pin it, as those of
 *   a repository and of one nested in it, or one lockfile found again through a
 *   symbolic link.
 */
export type RelockBlocker = 'unrecorded' | 'unreadable' | 'shared'
