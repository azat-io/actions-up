/**
 * Tell a file that does not exist apart from one that cannot be read or
 * checked.
 *
 * Nothing at the path, or a file where a directory of the path should be, means
 * there is no file. Any other failure, such as a missing permission, leaves
 * open what is there.
 *
 * @param error - Error a file system call rejected with.
 * @returns True when there is no file at the path.
 */
export function isMissingFileError(error: unknown): boolean {
  let { code } = error as NodeJS.ErrnoException
  return code === 'ENOENT' || code === 'ENOTDIR'
}
