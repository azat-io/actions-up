import { describe, expect, it } from 'vitest'

import { isMissingFileError } from '../../../core/fs/is-missing-file-error'

/**
 * Error a file system call rejects with.
 *
 * @param code - Code Node gives the error, such as `ENOENT`.
 * @returns Error for a definition of an action, carrying the code.
 */
function makeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: /repo/action.yml`), { code })
}

describe('isMissingFileError', () => {
  it.each(['ENOENT', 'ENOTDIR'])('tells that %s means no file', code => {
    expect(isMissingFileError(makeError(code))).toBe(true)
  })

  it.each(['EACCES', 'EIO', 'ELOOP'])(
    'leaves open what is there after %s',
    code => {
      expect(isMissingFileError(makeError(code))).toBe(false)
    },
  )
})
