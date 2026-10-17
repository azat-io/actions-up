import type { UpdateStyle } from './update-style'
import type { UpdateMode } from './update-mode'

/**
 * Options of `planUpdates`. Each one matches the CLI flag of the same name and
 * defaults to the same value.
 */
export interface PlanUpdatesOptions {
  /**
   * Whether actions pinned to branches are checked too, like
   * `--include-branches`. Defaults to false.
   */
  includeBranches?: boolean

  /**
   * Regular expressions for actions that skip the cool-down but still follow
   * the update mode, like `--min-age-exclude`.
   */
  minAgeExclude?: string[]

  /**
   * Directories to scan, like `--dir`. Defaults to `.github`, or to the working
   * directory with `recursive`.
   */
  directories?: string[]

  /**
   * Whether tags are compared with releases, like `--prefer-tags`. Defaults to
   * false.
   */
  preferTags?: boolean

  /**
   * Whether the directories are searched for workflows recursively, like
   * `--recursive`. Defaults to false.
   */
  recursive?: boolean

  /**
   * How an update is written, like `--style`. Defaults to `sha`.
   */
  style?: UpdateStyle

  /**
   * Regular expressions for actions and runners to leave out, like `--exclude`.
   * A pattern is written either plainly, matched without regard to case, or as
   * `/pattern/flags`.
   */
  exclude?: string[]

  /**
   * Which updates are allowed, like `--mode`. Defaults to `major`.
   */
  mode?: UpdateMode

  /**
   * Minimum age of a release in days, like `--min-age`. Defaults to 1; 0
   * disables the cool-down.
   */
  minAge?: number

  /**
   * GitHub token. Defaults to `GITHUB_TOKEN`, then to the one the GitHub CLI
   * holds.
   */
  token?: string

  /**
   * Directory the scan starts from. Defaults to the current working directory.
   */
  cwd?: string
}
