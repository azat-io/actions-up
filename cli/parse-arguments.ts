import { parseArgs } from 'node:util'

/**
 * Help text shown for `--help`.
 */
let helpText = `Usage:
  $ actions-up [options]

Options:
  --dir <directory>   Directory to scan (repeatable). Default: .github, or . with --recursive
  --dry-run           Preview changes without applying them
  --exclude <regex>   Exclude actions by regex (repeatable)
  --include-branches  Also check actions pinned to branches (default: false)
  --json              Output update information as machine-readable JSON
  --min-age <days>    Minimum age in days for updates (default: 1, use 0 to disable)
  --mode <mode>       Update mode: major, minor, or patch (default: major)
  --style <style>     Update style: sha, preserve or semver (default: sha)
  -r, --recursive     Recursively scan directories for YAML files
  -y, --yes           Skip all confirmations
  -q, --quiet         Suppress skipped/blocked warnings
  -h, --help          Display this message
  -v, --version       Display version number`

/**
 * ParseArgs configuration mirroring the previous cac option set.
 *
 * Kebab-case keys keep the CLI flags as `--dry-run`, `--min-age`, etc.;
 * parseArgs does not camelCase keys, so they are remapped manually below.
 */
let parserOptions = {
  exclude: { type: 'string', multiple: true },
  recursive: { type: 'boolean', short: 'r' },
  version: { type: 'boolean', short: 'v' },
  'include-branches': { type: 'boolean' },
  dir: { type: 'string', multiple: true },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  yes: { type: 'boolean', short: 'y' },
  'dry-run': { type: 'boolean' },
  'min-age': { type: 'string' },
  style: { type: 'string' },
  json: { type: 'boolean' },
  mode: { type: 'string' },
} as const

/**
 * CLI Options.
 */
export interface CLIOptions {
  /**
   * Regex patterns to exclude actions by name (repeatable).
   */
  exclude?: string[] | string

  /**
   * Whether to include branch references in update checks.
   */
  includeBranches?: boolean

  /**
   * Custom directory name (e.g., '.gitea' instead of '.github').
   */
  dir?: string[] | string

  /**
   * Recursively scan directories for YAML files.
   */
  recursive?: boolean

  /**
   * Suppress skipped and blocked-update warnings.
   */
  quiet?: boolean

  /**
   * Preview changes without applying them.
   */
  dryRun: boolean

  /**
   * Update style (sha, preserve or semver).
   */
  style?: string

  /**
   * Output a machine-readable JSON report.
   */
  json?: boolean

  /**
   * Minimum age in days for updates.
   */
  minAge: number

  /**
   * Update mode (major, minor, patch).
   */
  mode?: string

  /**
   * Skip all confirmations.
   */
  yes: boolean
}

/**
 * Result of parsing CLI arguments. `kind` discriminates what the caller should
 * do next.
 */
export type ParseArgumentsResult =
  | { options: CLIOptions; kind: 'options' }
  | { message: string; kind: 'error' }
  | { kind: 'version'; text: string }
  | { kind: 'help'; text: string }

/**
 * Parse CLI arguments into normalized options.
 *
 * Reproduces the previous cac behavior without its runtime magic: numeric
 * coercion for `--min-age` and the option defaults are applied manually here,
 * and kebab-case flags are mapped to the camelCase option shape.
 *
 * @param argv - Raw arguments, typically `process.argv.slice(2)`.
 * @param appVersion - Version string used for `--version`.
 * @returns A discriminated result describing what the caller should do.
 */
export function parseArguments(
  argv: string[],
  appVersion: string,
): ParseArgumentsResult {
  try {
    let { values } = parseArgs({
      allowPositionals: false,
      options: parserOptions,
      strict: true,
      args: argv,
    })

    if (values.help) {
      return { text: helpText, kind: 'help' }
    }

    if (values.version) {
      return {
        text: `actions-up/${appVersion} ${process.platform}-${process.arch} node-${process.version}`,
        kind: 'version',
      }
    }

    let rawMinAge = values['min-age']
    let minAge = rawMinAge === undefined ? 1 : Number(rawMinAge)

    if (!Number.isFinite(minAge) || minAge < 0) {
      return {
        message: `Invalid --min-age "${rawMinAge}". Expected a non-negative number.`,
        kind: 'error',
      }
    }

    return {
      options: {
        includeBranches: values['include-branches'],
        dryRun: values['dry-run'] ?? false,
        style: values.style ?? 'sha',
        mode: values.mode ?? 'major',
        recursive: values.recursive,
        yes: values.yes ?? false,
        exclude: values.exclude,
        quiet: values.quiet,
        json: values.json,
        dir: values.dir,
        minAge,
      },
      kind: 'options',
    }
  } catch (error) {
    return { message: (error as Error).message, kind: 'error' }
  }
}
