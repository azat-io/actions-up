import { colors } from '../core/interactive/colors'

/**
 * Prints the notice for a workflow lockfile that cannot be read.
 *
 * The workflows it tracks cannot be told apart then, so every workflow of its
 * `.github/workflows` is treated as tracked, and the updates of those workflows
 * and of the actions they run are skipped. A lockfile in a newer schema than
 * this release reads only becomes readable with a newer release. The notice
 * goes to stderr and is printed even with `--quiet`, since it changes what the
 * run writes.
 *
 * @param path - Path of the lockfile, as shown to the user.
 * @param reason - Why it cannot be read.
 */
export function printLockfileWarning(path: string, reason: string): void {
  console.warn(
    colors.yellow(
      `\n⚠️  ${path} cannot be read (${reason}), so the updates of every workflow next to it ` +
        'and of the actions they run are skipped',
    ),
  )
}
