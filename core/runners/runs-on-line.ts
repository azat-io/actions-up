/**
 * Build the pattern that matches a `runs-on` label on a single source line.
 *
 * The scanner tests a line with this before reporting a runner, and the writer
 * rewrites with the very same pattern, so a label can never be offered as an
 * update that the writer would then silently fail to apply.
 *
 * Only a key and its value on one line are matched. A YAML anchor, a value
 * carried to the next line and a key inside a flow mapping all fall outside it,
 * because rewriting them safely needs more than a line of context.
 *
 * @param label - Current label to match, taken literally.
 * @returns Pattern with `prefix`, `quote`, `after`, `comment` and `eol` groups.
 */
export function buildRunsOnPattern(label: string): RegExp {
  return new RegExp(
    String.raw`^(?<prefix>[ \t]*['"]?runs-on['"]?[ \t]*:[ \t]*)` +
      String.raw`(?<quote>['"]?)${escapeRegExp(label)}\k<quote>` +
      String.raw`(?<after>[ \t]*)(?<comment>#[^\r\n]*)?(?<eol>\r?)$`,
  )
}

/**
 * Read a single 1-based line out of file content.
 *
 * @param content - Original file content.
 * @param lineNumber - 1-based line number to read.
 * @returns The line, or null when the number falls outside the content.
 */
export function getLine(content: string, lineNumber: number): string | null {
  if (lineNumber <= 0) {
    return null
  }
  return content.split('\n')[lineNumber - 1] ?? null
}

/**
 * Escape a string for literal use inside a regular expression.
 *
 * @param value - Raw string to escape.
 * @returns Escaped string safe to embed in a pattern.
 */
function escapeRegExp(value: string): string {
  return value.replaceAll(/[$()*+\-./?[\\\]^{|}]/gu, String.raw`\$&`)
}
