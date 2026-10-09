/**
 * The parts of a process that decide whether to print colors.
 */
interface ColorContext {
  /**
   * Environment variables.
   */
  env: Record<string, undefined | string>

  /**
   * Standard output.
   */
  stdout: { isTTY?: boolean }

  /**
   * Operating system.
   */
  platform: string

  /**
   * Command line arguments.
   */
  argv: string[]
}

/**
 * Names of the colors the CLI uses.
 */
type ColorName =
  | 'yellowBright'
  | 'redBright'
  | 'bgBlack'
  | 'yellow'
  | 'green'
  | 'reset'
  | 'cyan'
  | 'gray'
  | 'red'

/**
 * Value a color function accepts. Numbers and empty values are printed as text.
 */
type ColorInput = undefined | string | number | null

/**
 * Wraps a value in a color, or turns it into plain text when colors are off.
 */
type Color = (input: ColorInput) => string

/**
 * Create the color functions.
 *
 * Each one works as in picocolors 1.1.1, so the output stays the same byte for
 * byte: it wraps the text in the opening and the ending code of its color, and
 * opens the color again after every nested color that ends it.
 *
 * @param enabled - Whether to add color codes.
 * @returns Color functions by name.
 */
export function createColors(
  enabled = isColorSupported(),
): Record<ColorName, Color> {
  /**
   * Create the function of one color.
   *
   * @param open - SGR code that starts the color.
   * @param close - SGR code that ends it.
   * @returns The color function.
   */
  function color(open: number, close: number): Color {
    let openCode = `\u{1B}[${open}m`
    let closeCode = `\u{1B}[${close}m`

    return input => {
      let text = String(input)
      if (!enabled) {
        return text
      }

      /**
       * As in picocolors, the search for nested colors starts after the length
       * of the opening code.
       */
      let index = text.indexOf(closeCode, openCode.length)
      if (index === -1) {
        return `${openCode}${text}${closeCode}`
      }
      let nested = text.slice(index).replaceAll(closeCode, openCode)
      return `${openCode}${text.slice(0, index)}${nested}${closeCode}`
    }
  }

  return {
    yellowBright: color(93, 39),
    redBright: color(91, 39),
    bgBlack: color(40, 49),
    yellow: color(33, 39),
    green: color(32, 39),
    cyan: color(36, 39),
    gray: color(90, 39),
    reset: color(0, 0),
    red: color(31, 39),
  }
}

/**
 * Check whether to print colors, by the rules of picocolors 1.1.1, kept as they
 * are so that colors show up where they did. `NO_COLOR` or `--no-color` turn
 * colors off. Otherwise `FORCE_COLOR`, `--color`, Windows, a terminal on
 * standard output other than `TERM=dumb`, or `CI` turn them on. Empty variables
 * count as unset, and `FORCE_COLOR=0` counts as set.
 *
 * @param context - Process to check.
 * @returns True when colors should be printed.
 */
export function isColorSupported({
  platform,
  stdout,
  argv,
  env,
}: ColorContext = process): boolean {
  if (env['NO_COLOR'] || argv.includes('--no-color')) {
    return false
  }
  if (
    platform === 'win32' ||
    env['FORCE_COLOR'] ||
    env['CI'] ||
    argv.includes('--color')
  ) {
    return true
  }
  return stdout.isTTY === true && env['TERM'] !== 'dumb'
}

/**
 * Color functions for the current process.
 */
export const colors = createColors()
