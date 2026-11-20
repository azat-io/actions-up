import type { ChildProcess } from 'node:child_process'

import { spawn } from 'node:child_process'

import type { GhResult } from '../../types/gh-result'

/**
 * Milliseconds that a command stopped for running out of time gets to end
 * before `gh` is killed and its output closed.
 */
const KILL_DELAY = 2000

/**
 * Where and how a `gh` command runs.
 */
interface RunGhOptions {
  /**
   * Variables added to the environment of the process.
   */
  env?: Record<string, string>

  /**
   * Milliseconds after which `gh` is stopped, none when omitted. When the
   * command has not ended a moment later, `gh` is killed and its output closed,
   * so that the result comes even while a process it started, such as an
   * extension, keeps that output open. Such a process may go on running, so
   * only a command that writes nothing should have a time limit.
   */
  timeout?: number

  /**
   * Directory the command runs in.
   */
  cwd: string
}

/**
 * Run the GitHub CLI.
 *
 * Every `gh` command of the lockfile support goes through this function, so
 * tests replace this one module instead of an installed `gh`. The command runs
 * without a shell, so no argument is ever interpreted, and with the environment
 * of the process, so `gh` picks its token the way it always does: `GH_TOKEN`,
 * then `GITHUB_TOKEN`, then its stored credentials. Only `GH_FORCE_TTY` is
 * cleared, since it turns the output meant for pipes into the one meant for a
 * terminal. Without a time limit, the result is ready only once every process
 * of the command has closed its output, so nothing it started is still writing
 * files then.
 *
 * @param ghArguments - Arguments after `gh`.
 * @param options - Where to run the command and how.
 * @returns How the command ended and what it printed.
 */
export function runGh(
  ghArguments: string[],
  options: RunGhOptions,
): Promise<GhResult> {
  return new Promise(resolve => {
    let child: ChildProcess

    /**
     * Node throws at once, instead of emitting an error, for a `gh` it cannot
     * run at all, such as a script without a shebang line.
     */
    try {
      child = spawn('gh', ghArguments, {
        env: { ...process.env, GH_FORCE_TTY: '', ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: options.cwd,
      })
    } catch (error) {
      resolve({
        startError: (error as NodeJS.ErrnoException).code ?? null,
        started: false,
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
      })
      return
    }

    let stdout: Buffer[] = []
    let stderr: Buffer[] = []
    let startError: string | null = null
    let started = true

    /**
     * A command that does not end once stopped is killed, and its output is
     * closed too, since a process it started may hold that output open. What it
     * printed until then is kept.
     */
    let timer: NodeJS.Timeout | undefined =
      options.timeout === undefined ?
        undefined
      : setTimeout(() => {
          child.kill()
          timer = setTimeout(() => {
            child.kill('SIGKILL')
            child.stdout?.destroy()
            child.stderr?.destroy()
          }, KILL_DELAY)
        }, options.timeout)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
    })

    /**
     * A process that got no ID was never started, and one Node ran out of file
     * descriptors for gets no output either. Any other error, such as a signal
     * that could not be delivered, leaves the exit to tell how it ended.
     */
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (child.pid === undefined) {
        startError = error.code ?? null
        started = false
      }
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: started ? code : null,
        startError,
        started,
        signal,
      })
    })
  })
}
