import type { PathLike, Stats } from 'node:fs'

import { dirname, resolve } from 'node:path'

/**
 * In-memory replacement for the `node:fs/promises` functions the scanners and
 * the updater call.
 */
export interface FakeFileSystem {
  /**
   * Overwrite or create a file with the given bytes, or with the given text in
   * the given encoding, UTF-8 by default, the way `node:fs` encodes it.
   */
  writeFile(
    path: PathLike,
    content: Uint8Array | string,
    options?: WriteFileOptions,
  ): Promise<void>

  /**
   * Contents of a file, following symbolic links. Like `node:fs`, the text is
   * returned only when an encoding is requested; otherwise the bytes are.
   */
  readFile(
    path: PathLike,
    options?: ReadFileOptions,
  ): Promise<Buffer<ArrayBuffer> | string>

  /**
   * Current text of a file, read as UTF-8, or undefined when there is no such
   * file.
   */
  contentOf(path: string): undefined | string

  /**
   * Names of the entries inside a directory, sorted.
   */
  readdir(path: PathLike): Promise<string[]>

  /**
   * Current bytes of a file, or undefined when there is no such file.
   */
  bytesOf(path: string): undefined | Buffer

  /**
   * Path the entry is reached at once a symbolic link at it is followed.
   */
  realpath(path: PathLike): Promise<string>

  /**
   * Entry kind without following symbolic links.
   */
  lstat(path: PathLike): Promise<Stats>

  /**
   * Entry kind, following symbolic links.
   */
  stat(path: PathLike): Promise<Stats>
}

/**
 * Entry of the fake file system that is not a readable file.
 */
export type FakeEntry =
  | {
      /**
       * Directory, or a directory or file whose contents cannot be read.
       */
      kind: 'unreadable-directory' | 'unreadable-file' | 'directory'
    }
  | {
      /**
       * Symbolic link.
       */
      kind: 'symlink'

      /**
       * Absolute path the link points to.
       */
      target: string
    }

/**
 * Entry kinds stored by the fake file system.
 */
type StoredEntry =
  | {
      kind: 'unreadable-directory' | 'unreadable-file' | 'directory'
    }
  | {
      kind: 'symlink'
      target: string
    }
  | {
      content: Buffer
      kind: 'file'
    }

/**
 * Encoding argument of `readFile`: a name, an options object, or nothing.
 */
type ReadFileOptions =
  | {
      /**
       * Text encoding; bytes are returned when it is missing.
       */
      encoding?: BufferEncoding | null
    }
  | BufferEncoding
  | null

/**
 * Encoding argument of `writeFile` for text: a name, an options object, or
 * nothing for UTF-8.
 */
type WriteFileOptions =
  | {
      /**
       * Text encoding; UTF-8 when it is missing.
       */
      encoding?: BufferEncoding | null
    }
  | BufferEncoding
  | null

/**
 * Build an in-memory file system from absolute paths.
 *
 * A string value is the text of a file, stored as UTF-8, and a buffer holds its
 * bytes. Every ancestor of an entry is a directory, so a tree is described by
 * its files alone. Failures reject with Node-style errors (`ENOENT`, `ENOTDIR`,
 * `EISDIR`, `EACCES`).
 *
 * @param entries - Absolute paths mapped to file text, file bytes or special
 *   entries.
 * @returns Fake file system whose functions can be installed into mocks.
 */
export function createFakeFileSystem(
  entries: Record<string, FakeEntry | string | Buffer>,
): FakeFileSystem {
  let stored = new Map<string, StoredEntry>()

  for (let [path, entry] of Object.entries(entries)) {
    stored.set(
      resolve(path),
      typeof entry === 'string' || Buffer.isBuffer(entry) ?
        { content: Buffer.from(entry), kind: 'file' }
      : entry,
    )
  }

  let directories = new Set(stored.keys().flatMap(path => ancestorsOf(path)))
  for (let directory of directories) {
    if (!stored.has(directory)) {
      stored.set(directory, { kind: 'directory' })
    }
  }

  function find(path: PathLike, syscall: string): StoredEntry {
    let entry = stored.get(resolve(String(path)))
    if (!entry) {
      throw createError('ENOENT', syscall, path)
    }
    return entry
  }

  function realPath(path: PathLike, syscall: string): string {
    let current = resolve(String(path))
    let entry = find(current, syscall)
    let hops = 0
    while (entry.kind === 'symlink') {
      hops += 1
      if (hops > stored.size) {
        throw createError('ELOOP', syscall, path)
      }
      current = resolve(entry.target)
      entry = find(current, syscall)
    }
    return current
  }

  function follow(path: PathLike, syscall: string): StoredEntry {
    return find(realPath(path, syscall), syscall)
  }

  function listDirectory(path: PathLike): string[] {
    let directory = realPath(path, 'readdir')
    let entry = find(directory, 'readdir')
    if (entry.kind === 'unreadable-directory') {
      throw createError('EACCES', 'readdir', path)
    }
    if (entry.kind !== 'directory') {
      throw createError('ENOTDIR', 'readdir', path)
    }
    return stored
      .keys()
      .filter(child => child !== directory && dirname(child) === directory)
      .map(child => child.slice(directory.length).replace(/^\//u, ''))
      .toArray()
      .toSorted()
  }

  function readBytes(path: PathLike): Buffer {
    let entry = follow(path, 'open')
    if (entry.kind === 'unreadable-file') {
      throw createError('EACCES', 'open', path)
    }
    if (entry.kind !== 'file') {
      throw createError('EISDIR', 'read', path)
    }
    return entry.content
  }

  function bytesOf(path: string): undefined | Buffer {
    let entry = stored.get(resolve(path))
    return entry?.kind === 'file' ? Buffer.from(entry.content) : undefined
  }

  return {
    writeFile: (path, content, options) =>
      settle(() => {
        let encoding = typeof options === 'string' ? options : options?.encoding
        stored.set(resolve(String(path)), {
          content:
            typeof content === 'string' ?
              Buffer.from(content, encoding ?? 'utf8')
            : Buffer.from(content),
          kind: 'file',
        })
      }),
    readFile: (path, options) =>
      settle(() => {
        let bytes = readBytes(path)
        let encoding = typeof options === 'string' ? options : options?.encoding
        return encoding ? bytes.toString(encoding) : Buffer.from(bytes)
      }),
    stat: path => settle(() => describeEntry(follow(path, 'stat').kind)),
    lstat: path => settle(() => describeEntry(find(path, 'lstat').kind)),
    realpath: path => settle(() => realPath(path, 'realpath')),
    contentOf: path => bytesOf(path)?.toString('utf8'),
    readdir: path => settle(() => listDirectory(path)),
    bytesOf,
  }
}

/**
 * Directory that exists but cannot be listed.
 *
 * @returns Unreadable directory entry.
 */
export function fakeUnreadableDirectory(): FakeEntry {
  return { kind: 'unreadable-directory' }
}

/**
 * Symbolic link to another entry of the same fake file system.
 *
 * @param target - Absolute path the link points to.
 * @returns Symbolic link entry.
 */
export function fakeSymlink(target: string): FakeEntry {
  return { kind: 'symlink', target }
}

/**
 * File that exists but cannot be read.
 *
 * @returns Unreadable file entry.
 */
export function fakeUnreadableFile(): FakeEntry {
  return { kind: 'unreadable-file' }
}

/**
 * Directory that holds no files, for trees where it must exist empty.
 *
 * @returns Directory entry.
 */
export function fakeDirectory(): FakeEntry {
  return { kind: 'directory' }
}

/**
 * Stats object that answers only the kind questions the production code asks.
 *
 * @param kind - Kind of the stored entry.
 * @returns Stats-like object.
 */
function describeEntry(kind: StoredEntry['kind']): Stats {
  return {
    isDirectory: () => kind === 'directory' || kind === 'unreadable-directory',
    isFile: () => kind === 'file' || kind === 'unreadable-file',
    isSymbolicLink: () => kind === 'symlink',
  } as Stats
}

/**
 * Every directory above a path, up to the file system root.
 *
 * @param path - Absolute path.
 * @returns Ancestor directories, nearest first.
 */
function ancestorsOf(path: string): string[] {
  let ancestors: string[] = []
  for (
    let parent = dirname(path);
    !ancestors.includes(parent);
    parent = dirname(parent)
  ) {
    ancestors.push(parent)
  }
  return ancestors
}

/**
 * Build an error shaped like the ones `node:fs` rejects with.
 *
 * @param code - Error code such as `ENOENT`.
 * @param syscall - Name of the failed system call.
 * @param path - Path the call was made with.
 * @returns Error with `code`, `syscall` and `path` set.
 */
function createError(
  code: string,
  syscall: string,
  path: PathLike,
): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${syscall} '${String(path)}'`), {
    path: String(path),
    syscall,
    code,
  })
}

/**
 * Run a synchronous operation as a promise that rejects when it throws, the way
 * the asynchronous `node:fs/promises` functions report failures.
 *
 * @param operation - Operation to run.
 * @returns Promise settled with the operation's outcome.
 */
async function settle<T>(operation: () => T): Promise<T> {
  /**
   * Yield once, so callers observe the result asynchronously like real I/O.
   */
  await Promise.resolve()
  return operation()
}
