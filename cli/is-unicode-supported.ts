/**
 * Check whether the terminal can show the Unicode frames and marks of the
 * spinner.
 *
 * Every platform but Windows is assumed to show Unicode outside the Linux
 * console. On Windows only CI and the terminals known to show it qualify.
 *
 * @returns True when Unicode symbols are safe to print.
 */
export function isUnicodeSupported(): boolean {
  let { platform, env } = process
  if (platform !== 'win32') {
    return env['TERM'] !== 'linux'
  }
  return (
    Boolean(env['CI']) ||
    Boolean(env['WT_SESSION']) ||
    env['ConEmuTask'] === '{cmd::Cmder}' ||
    env['TERM_PROGRAM'] === 'vscode' ||
    env['TERM'] === 'xterm-256color' ||
    env['TERM'] === 'alacritty'
  )
}
