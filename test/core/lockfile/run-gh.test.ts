import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ChildProcess, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'

import { runGh } from '../../../core/lockfile/run-gh'

vi.mock(import('node:child_process'), async importOriginal => ({
  ...(await importOriginal()),
  spawn: vi.fn(),
}))

/**
 * Process ID of a started command.
 */
const GH_PID = 4242

/**
 * Create the process of a command that prints nothing until the test makes it.
 *
 * @param pid - Process ID, null for a command that could not be started.
 * @returns Process whose output and events the test drives.
 */
function makeChild(pid: number | null = GH_PID): ChildProcess {
  return Object.assign(new ChildProcess(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: pid ?? undefined,
    kill: vi.fn(),
  })
}

describe('runGh', () => {
  let child: ChildProcess

  beforeEach(() => {
    vi.resetAllMocks()
    child = makeChild()
    vi.mocked(spawn).mockReturnValue(child)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('runs gh without a shell, in the given directory, with the variables added to the environment and output meant for pipes', async () => {
    let result = runGh(['actions-lock', '--no-onboard'], {
      env: { GH_ACTIONS_LOCK_REPO_ROOT: '/repo' },
      cwd: '/repo',
    })
    let check = Buffer.from('✓ relocked\n')
    child.stdout!.emit('data', Buffer.from('{"findings":'))
    child.stdout!.emit('data', Buffer.from('[]}\n'))
    child.stderr!.emit('data', check.subarray(0, 2))
    child.stderr!.emit('data', check.subarray(2))
    child.emit('close', 0, null)

    await expect(result).resolves.toStrictEqual({
      stdout: '{"findings":[]}\n',
      stderr: '✓ relocked\n',
      started: true,
      signal: null,
      exitCode: 0,
    })
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      'gh',
      ['actions-lock', '--no-onboard'],
      {
        env: {
          ...process.env,
          GH_ACTIONS_LOCK_REPO_ROOT: '/repo',
          GH_FORCE_TTY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        cwd: '/repo',
      },
    )
  })

  it('reports the exit code of a command that failed, with what it printed', async () => {
    let result = runGh(['actions-lock'], { cwd: '/repo' })
    child.stderr!.emit('data', Buffer.from('no token\n'))
    child.emit('close', 2, null)

    await expect(result).resolves.toStrictEqual({
      stderr: 'no token\n',
      started: true,
      signal: null,
      exitCode: 2,
      stdout: '',
    })
  })

  it('reports that gh could not be started', async () => {
    child = makeChild(null)
    vi.mocked(spawn).mockReturnValue(child)

    let result = runGh(['extension', 'list'], { cwd: '/repo' })
    child.emit('error', new Error('spawn gh ENOENT'))
    child.emit('close', -2, null)

    await expect(result).resolves.toStrictEqual({
      started: false,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
    })
  })

  it('reports that gh could not be started when Node has no file descriptors left for its output', async () => {
    child = Object.assign(new ChildProcess(), {
      pid: undefined,
      kill: vi.fn(),
      stdout: null,
      stderr: null,
    })
    vi.mocked(spawn).mockReturnValue(child)

    let result = runGh(['extension', 'list'], { cwd: '/repo' })
    child.emit('error', new Error('spawn EMFILE'))
    child.emit('close', -24, null)

    await expect(result).resolves.toStrictEqual({
      started: false,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
    })
  })

  it('reports that gh could not be started when Node cannot run it at all', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawn ENOEXEC')
    })

    await expect(
      runGh(['extension', 'list'], { cwd: '/repo' }),
    ).resolves.toStrictEqual({
      started: false,
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
    })
  })

  it('keeps a started command started when it reports an error later', async () => {
    let result = runGh(['actions-lock'], { cwd: '/repo' })
    child.emit('error', new Error('kill EPERM'))
    child.emit('close', 1, null)

    await expect(result).resolves.toMatchObject({ started: true, exitCode: 1 })
  })

  it('reports the signal that ended gh', async () => {
    let result = runGh(['actions-lock'], { cwd: '/repo' })
    child.emit('close', null, 'SIGINT')

    await expect(result).resolves.toMatchObject({
      signal: 'SIGINT',
      exitCode: null,
      started: true,
    })
  })

  it('stops gh once it runs out of time', async () => {
    vi.useFakeTimers()
    let result = runGh(['extension', 'list'], { timeout: 30_000, cwd: '/repo' })

    vi.advanceTimersByTime(29_999)
    expect(child.kill).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(child.kill).toHaveBeenCalledExactlyOnceWith()

    child.emit('close', null, 'SIGTERM')

    await expect(result).resolves.toMatchObject({
      signal: 'SIGTERM',
      exitCode: null,
    })
  })

  it('stops waiting for the time limit once the command exits', async () => {
    vi.useFakeTimers()
    let result = runGh(['extension', 'list'], { timeout: 30_000, cwd: '/repo' })
    child.emit('close', 0, null)
    await result

    vi.advanceTimersByTime(30_000)

    expect(child.kill).not.toHaveBeenCalled()
  })
})
