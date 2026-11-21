import { colors } from '../core/interactive/colors'

/**
 * Prints the notice for a workflow lockfile whose workflows cannot all be
 * traced, naming the file that cannot be read.
 *
 * Which actions of the repository the workflows run is unknown then, so any of
 * them may run remote actions through `./`, and the updates the lockfile pins
 * are skipped, however few of its workflows the file concerns. The notice goes
 * to stderr and is printed even with `--quiet`, since it changes what the run
 * writes.
 *
 * @param file - Workflow or action definition that cannot be read, as shown to
 *   the user.
 * @param lockfile - Path of the lockfile, as shown to the user.
 */
export function printUntracedWarning(file: string, lockfile: string): void {
  console.warn(
    colors.yellow(
      `\n⚠️  ${file} cannot be read, so the updates pinned by ${lockfile} are skipped`,
    ),
  )
}
