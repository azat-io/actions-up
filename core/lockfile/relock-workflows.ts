import { dirname } from 'node:path'

import type { WorkflowLockfile } from '../../types/workflow-lockfile'
import type { RelockResult } from '../../types/relock-result'
import type { LockRefusal } from '../../types/lock-refusal'
import type { LockFinding } from '../../types/lock-finding'
import type { GhResult } from '../../types/gh-result'
import type { LockPin } from '../../types/lock-pin'

import { isRecord } from '../parsing/is-record'
import { runGh } from './run-gh'

/**
 * Flags that keep a relock to the references Actions Up wrote:
 *
 * - `--no-onboard`: only what the lockfile already tracks is pinned again; adding
 *   a workflow or an action to it stays the decision of the user.
 * - `--no-narrow`: every reference keeps the version it was written with. Without
 *   it, gh-actions-lock narrows a partial version to an exact one on lines
 *   nobody selected, and replaces a commit SHA with the tag it finds for it,
 *   pinning that tag, so that no reference written in the SHA style would be
 *   pinned as written. It still renames a repository that moved.
 *
 * `--ignore-local-actions` is left out on purpose. Without it, the relock
 * blocks on a `./` action of the workspace that runs remote actions, wherever
 * the `./` is written: in the workflow, in an action of the repository, or in a
 * remote composite action, which runs the `./` from the workspace too. The
 * lockfile cannot record what such an action runs, and a relock drops the pins
 * of references the workflow no longer runs itself, which the action may still
 * need. The plan skips the workflows that run such actions from the repository;
 * this covers the remote ones, which only gh-actions-lock reads.
 */
const RELOCK_FLAGS = ['--no-onboard', '--no-narrow']

/**
 * Kinds of finding a relock fixes on its own: a written reference the lockfile
 * does not pin yet, and a pin no workflow uses any longer. Such a finding
 * always names its dependency; one of these kinds that names none, such as a
 * reference a composite action writes with more than one `@`, is something
 * else.
 */
const SELF_FIXED = new Set(['ref-changed', 'not-pinned', 'stale'])

/**
 * Start of what `gh` writes to standard error for a command it does not know,
 * as for gh-actions-lock once it is uninstalled.
 */
const UNKNOWN_COMMAND = 'unknown command "actions-lock"'

/**
 * Matches a path that a POSIX shell reads as it is written.
 */
const PLAIN_PATH = /^[\w\-./]+$/u

/**
 * Regenerate a workflow lockfile for the given workflows with gh-actions-lock.
 *
 * The command runs from the root of the repository the lockfile belongs to,
 * named by `GH_ACTIONS_LOCK_REPO_ROOT` as well, so the tool never picks the
 * lockfile of an enclosing repository, and names the directory of the lockfile
 * by `GH_ACTIONS_LOCK_WORKFLOWS_DIR`, which would otherwise point the tool at
 * another lockfile whenever the environment sets it. The workflows are named by
 * the keys of the lockfile, since the tool finds their entries by the path it
 * is given. It waits for no input and reports as JSON what blocked it or, when
 * it wrote the lockfile, what it pins and what it refused to pin. A run that
 * blocks writes nothing; the exit code, not the findings, tells whether the
 * lockfile was regenerated. The paths follow `--`, so that none is read as a
 * flag.
 *
 * @param lockfile - Workflow lockfile to regenerate.
 * @param workflows - Tracked workflows to relock, as the lockfile names them;
 *   at least one, since gh-actions-lock relocks every workflow without any.
 * @returns Whether the lockfile was regenerated, and why not.
 */
export async function relockWorkflows(
  lockfile: WorkflowLockfile,
  workflows: string[],
): Promise<RelockResult> {
  let result = await runGh(
    [
      'actions-lock',
      ...RELOCK_FLAGS,
      '--no-interactive',
      '--json=findings,pins',
      '--',
      ...workflows,
    ],
    {
      env: {
        GH_ACTIONS_LOCK_WORKFLOWS_DIR: dirname(lockfile.path),
        GH_ACTIONS_LOCK_REPO_ROOT: lockfile.root,
      },
      cwd: lockfile.root,
    },
  )

  let report = readReport(result.stdout)

  if (result.exitCode === 0) {
    return {
      refusals: readRefusals(report),
      pins: readPins(report),
      kind: 'relocked',
    }
  }

  if (result.signal !== null) {
    return { signal: result.signal, kind: 'stopped' }
  }

  /**
   * The tool reports the findings that blocked it as JSON. Exit code 1 without
   * them comes from `gh` itself, as when it cannot run the extension.
   */
  let blocked = result.exitCode === 1 && Array.isArray(report['findings'])
  return {
    reason: describeFailure(result, blocked),
    findings: readFindings(report),
    kind: 'failed',
  }
}

/**
 * Write the command that regenerates a workflow lockfile the way Actions Up
 * does, for the user to run from the working directory.
 *
 * The command names the root of the repository of the lockfile as the root, and
 * the directory of the lockfile below it, the way Actions Up runs it, so that
 * gh-actions-lock does not take the lockfile or the `$/` references of an
 * enclosing Git repository instead, or the lockfile the environment names, or
 * fail where there is no Git repository at all. The directory is named from the
 * root, as the lockfile names its workflows: run without the workflows, the
 * command then checks every workflow of that directory, while an absolute
 * directory would make gh-actions-lock look them up under other names, prune
 * every entry of the lockfile and delete it. Outside that root, the command
 * changes to it first, through a path that starts with a dot, so that `CDPATH`
 * does not lead elsewhere and a leading dash is not read as an option. The path
 * is followed physically, since it leads from the real working directory: a
 * shell would otherwise take `..` back through the symbolic link it entered
 * by.
 *
 * @param workflows - Tracked workflows to relock, as the lockfile names them.
 * @param directory - Root of the repository of the lockfile, relative to the
 *   working directory; empty when it is the working directory.
 * @returns The command, with each path quoted when a shell would split it.
 */
export function formatRelockCommand(
  workflows: string[],
  directory: string,
): string {
  let command = [
    'gh actions-lock',
    ...RELOCK_FLAGS,
    '--',
    ...workflows.map(quotePath),
  ].join(' ')
  let rooted = `GH_ACTIONS_LOCK_REPO_ROOT="$PWD" GH_ACTIONS_LOCK_WORKFLOWS_DIR=.github/workflows ${command}`
  if (directory === '') {
    return rooted
  }
  let root = quotePath(
    directory === '..' || directory.startsWith('../') ?
      directory
    : `./${directory}`,
  )
  return `(cd -P ${root} && ${rooted})`
}

/**
 * Read the references a regenerated lockfile was refused for from the JSON
 * gh-actions-lock prints.
 *
 * With `--no-onboard`, the tool does not add an action to the entry of a
 * workflow that did not track it, even when the entry of another workflow does,
 * and reports that as information, so the run still succeeds. The finding names
 * the workflow, and the reference as `owner/repo@ref`, with the path of an
 * action in a subdirectory after the repository.
 *
 * @param report - JSON the command printed.
 * @returns The refused references.
 */
function readRefusals(report: Record<string, unknown>): LockRefusal[] {
  return readEntries(report, 'findings').flatMap((finding): LockRefusal[] => {
    let workflow = readString(finding, 'workflow')
    let dependency = readString(finding, 'dependency') ?? ''
    let [name = '', ...parts] = dependency.split('@')
    let [owner, repository] = name.split('/', 2)
    let reference = parts.join('@')
    return (
        workflow &&
          owner &&
          repository &&
          reference &&
          finding['category'] === 'onboarding-required'
      ) ?
        [
          {
            repository: `${owner}/${repository}`.toLowerCase(),
            ref: reference,
            dependency,
            workflow,
          },
        ]
      : []
  })
}

/**
 * Read the findings that block the lockfile from the JSON gh-actions-lock
 * prints. A finding without a severity counts as blocking.
 *
 * A run that fails reports the lockfile as it was before the fix, so each
 * written reference shows up as a finding the relock would fix on its own,
 * naming the reference as its dependency. Such findings are left out: they
 * blame the update rather than what blocked it.
 *
 * @param report - JSON the command printed.
 * @returns The blocking findings.
 */
function readFindings(report: Record<string, unknown>): LockFinding[] {
  return readEntries(report, 'findings').flatMap((finding): LockFinding[] => {
    let category = readString(finding, 'category') ?? ''
    if (
      (finding['severity'] ?? 'error') !== 'error' ||
      (SELF_FIXED.has(category) && readString(finding, 'dependency') !== null)
    ) {
      return []
    }
    return [
      {
        detail: readString(finding, 'detail') ?? category,
        workflow: readString(finding, 'workflow') ?? '',
        docUrl: readString(finding, 'doc_url'),
        category,
      },
    ]
  })
}

/**
 * Say in one line why gh-actions-lock did not regenerate the lockfile.
 *
 * A run that blocked on findings says so, since standard error then holds only
 * its progress. A `gh` that no longer knows the extension, which was found
 * before the run, says it is not installed. Otherwise the tool, or `gh`, failed
 * for itself, and the last line it wrote to standard error says why, with the
 * exit code, as that line may be progress the tool wrote before it was
 * stopped.
 *
 * @param result - How the command ended.
 * @param blocked - Whether the run blocked on findings it reported.
 * @returns The reason.
 */
function describeFailure(result: GhResult, blocked: boolean): string {
  if (!result.started) {
    return 'gh could not be started'
  }

  if (blocked) {
    return 'it found problems that block the lockfile'
  }

  if (result.stderr.startsWith(UNKNOWN_COMMAND)) {
    return 'gh-actions-lock is not installed'
  }

  let lastLine = result.stderr
    .split('\n')
    .map(line => line.trim())
    .findLast(line => line !== '')

  return lastLine === undefined ?
      `it exited with code ${result.exitCode}`
    : `${lastLine} (exit code ${result.exitCode})`
}

/**
 * Read what a regenerated lockfile pins from the JSON gh-actions-lock prints.
 *
 * @param report - JSON the command printed.
 * @returns Commit of each reference, with its repository in lower case.
 */
function readPins(report: Record<string, unknown>): LockPin[] {
  return readEntries(report, 'pins').flatMap((pin): LockPin[] => {
    let repository = readString(pin, 'nwo')
    let reference = readString(pin, 'ref')
    let sha = readString(pin, 'sha')
    return repository && reference && sha ?
        [
          {
            repository: repository.toLowerCase(),
            sha: sha.toLowerCase(),
            ref: reference,
          },
        ]
      : []
  })
}

/**
 * Read the objects of a list in the JSON gh-actions-lock prints.
 *
 * @param report - JSON the command printed.
 * @param field - Name of the list.
 * @returns The objects of the list, or none when the report holds no such list.
 */
function readEntries(
  report: Record<string, unknown>,
  field: string,
): Record<string, unknown>[] {
  let entries = report[field]
  return Array.isArray(entries) ? entries.filter(isRecord) : []
}

/**
 * Read the JSON gh-actions-lock prints.
 *
 * @param stdout - Standard output of the command.
 * @returns The report, empty when the output holds no readable JSON object.
 */
function readReport(stdout: string): Record<string, unknown> {
  let report: unknown
  try {
    report = JSON.parse(stdout)
  } catch {
    return {}
  }
  return isRecord(report) ? report : {}
}

/**
 * Read a text field of an object of the JSON.
 *
 * @param entry - Object as parsed from the JSON.
 * @param key - Name of the field.
 * @returns The text, or null when the field holds none.
 */
function readString(
  entry: Record<string, unknown>,
  key: string,
): string | null {
  let value = entry[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Quote a path for a POSIX shell when it would not read it as written.
 *
 * @param path - Path to quote.
 * @returns The path as a shell word.
 */
function quotePath(path: string): string {
  return PLAIN_PATH.test(path) ? path : (
      `'${path.replaceAll("'", String.raw`'\''`)}'`
    )
}
