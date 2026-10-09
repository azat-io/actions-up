import type { MultiselectEntry } from '../../../types/multiselect-entry'
import type { MultiselectState } from '../../../types/multiselect-state'

import { getSelectedValues } from './get-selected-values'
import { countScreenRows } from './count-screen-rows'
import { stripAnsi } from '../strip-ansi'
import { colors } from '../colors'

/**
 * Symbols of the prompt in most terminals.
 */
const UNICODE_SYMBOLS = { ellipsis: '…', check: '✔', cross: '✖' }

/**
 * Symbols of the prompt in a Windows console.
 */
const WINDOWS_SYMBOLS = { ellipsis: '...', check: '√', cross: '×' }

/**
 * How to draw a multiselect prompt.
 */
interface RenderMultiselectOptions<Value> {
  /**
   * Describe the submitted selection after the question, or return an empty
   * string to say that nothing was selected.
   *
   * @param values - Values of the selected options, in the order of the list.
   * @returns Text after the question.
   */
  summarize(values: Value[]): string

  /**
   * Whether the terminal is a Windows console, which gets the symbols of
   * Windows.
   */
  isWindowsConsole: boolean

  /**
   * Question on the first line, possibly colored.
   */
  message: string

  /**
   * Width of the terminal.
   */
  columns: number

  /**
   * Line under the list, after a blank line.
   */
  footer: string

  /**
   * Position of the first line of the list in the last frame.
   */
  start: number

  /**
   * Height of the terminal.
   */
  rows: number
}

/**
 * Text of a multiselect prompt to write to the terminal.
 */
interface MultiselectFrame {
  /**
   * Question part of the first line: the line without the summary of a
   * submitted selection.
   */
  prompt: string

  /**
   * Position of the first line of the list in the frame.
   */
  start: number

  /**
   * Text of the frame, with lines separated by `\n`.
   */
  text: string
}

/**
 * Draw a multiselect prompt the way enquirer 2.4.1 drew it, so that it looks
 * exactly the same.
 *
 * While the user chooses, the frame holds the question, the lines of the list,
 * a blank line and the footer. The focused line gets a cyan pointer, and its
 * text a black background unless it cannot be selected; an option shows a dot,
 * filled when it is selected, and a group label a gray one, filled when every
 * option of the group is selected. Once the prompt closes, only the question is
 * left, followed by the summary of the selection.
 *
 * When the frame is taller than the terminal, the list shows a window of its
 * lines that holds the focused line, moving as little as possible from where it
 * was in the last frame.
 *
 * @param state - State of the prompt.
 * @param options - How to draw it.
 * @returns The frame.
 */
export function renderMultiselect<Value>(
  state: MultiselectState<Value>,
  options: RenderMultiselectOptions<Value>,
): MultiselectFrame {
  let { status } = state
  let symbols = options.isWindowsConsole ? WINDOWS_SYMBOLS : UNICODE_SYMBOLS
  let prefixes = {
    cancelled: colors.magenta(symbols.cross),
    submitted: colors.reset(symbols.check),
    pending: colors.cyan('?'),
  }
  let message =
    hasColor(options.message) ? options.message : colors.bold(options.message)
  let separator = colors.dim(status === 'pending' ? symbols.ellipsis : '·')
  let prompt = `${prefixes[status]} ${message} ${separator} `

  if (status !== 'pending') {
    let summary =
      status === 'submitted' ? options.summarize(getSelectedValues(state)) : ''
    return {
      text: `${prompt}${summary || colors.magenta('No items were selected')}`,
      start: options.start,
      prompt,
    }
  }

  let lines = state.entries.map((entry, index) =>
    renderEntry(state, entry, index),
  )
  let { start, end } = fitWindow({
    budget:
      options.rows -
      countScreenRows(prompt, options.columns) -
      1 -
      countScreenRows(options.footer, options.columns),
    heights: lines.map(line => countScreenRows(line, options.columns)),
    previousStart: options.start,
    focus: state.focus,
  })
  return {
    text: [prompt, lines.slice(start, end).join('\n'), '', options.footer].join(
      '\n',
    ),
    prompt,
    start,
  }
}

/**
 * Draw one line of the list.
 *
 * @param state - State of the prompt.
 * @param entry - Line to draw.
 * @param index - Position of the line in the list.
 * @returns Text of the line.
 */
function renderEntry<Value>(
  state: MultiselectState<Value>,
  entry: MultiselectEntry<Value>,
  index: number,
): string {
  let isFocused = index === state.focus
  let pointer = isFocused ? colors.cyan('❯') : ' '
  if (entry.kind === 'group') {
    let isFilled = getGroupOptions(state.entries, index).every(option =>
      state.selected.has(option),
    )
    return joinParts(
      `${pointer} ${colors.gray(isFilled ? '●' : '○')}`,
      isFocused ? colors.bgBlack(entry.message) : entry.message,
    )
  }
  if (entry.kind === 'separator') {
    return joinParts(
      `${pointer}${colors.reset(' ')}`,
      dimUnlessColored(entry.message),
    )
  }
  let check = `${pointer}${colors.reset(`   ${state.selected.has(index) ? '●' : '○'}`)}`
  if (entry.disabled) {
    return joinParts(
      check,
      dimUnlessColored(entry.message),
      colors.dim('(disabled)'),
    )
  }
  return joinParts(
    check,
    isFocused ? colors.bgBlack(entry.message) : entry.message,
  )
}

/**
 * Find the lines of the list to show: all of them when they fit, otherwise a
 * window that holds the focused line. The window keeps its start while the
 * focused line stays in it, and fills the rows left at the end of the list.
 *
 * @param layout - What decides the window.
 * @param layout.heights - Rows of the screen each line of the list takes.
 * @param layout.focus - Position of the focused line.
 * @param layout.previousStart - Start of the window in the last frame.
 * @param layout.budget - Rows of the screen left for the list.
 * @returns Position of the first line to show and the position after the last.
 */
function fitWindow({
  previousStart,
  heights,
  budget,
  focus,
}: {
  previousStart: number
  heights: number[]
  budget: number
  focus: number
}): { start: number; end: number } {
  if (sum(heights) <= budget) {
    return { end: heights.length, start: 0 }
  }
  let start = Math.min(previousStart, focus)
  let used = sum(heights.slice(start, focus + 1))
  while (used > budget && start < focus) {
    used -= heights[start]!
    start += 1
  }
  let end = focus + 1
  while (end < heights.length && used + heights[end]! <= budget) {
    used += heights[end]!
    end += 1
  }
  while (start > 0 && used + heights[start - 1]! <= budget) {
    start -= 1
    used += heights[start]!
  }
  return { start, end }
}

/**
 * Positions of every option of a group, disabled ones included: the options
 * from its label down to the next label.
 *
 * @param entries - Lines of the list.
 * @param group - Position of the group label.
 * @returns Positions of the options.
 */
function getGroupOptions(
  entries: MultiselectEntry<unknown>[],
  group: number,
): number[] {
  let positions: number[] = []
  for (let index = group + 1; index < entries.length; index++) {
    let entry = entries[index]!
    if (entry.kind === 'group') {
      break
    }
    if (entry.kind === 'option') {
      positions.push(index)
    }
  }
  return positions
}

/**
 * Add up numbers.
 *
 * @param values - Numbers to add up.
 * @returns Total of the numbers, 0 for none.
 */
function sum(values: number[]): number {
  let total = 0
  for (let value of values) {
    total += value
  }
  return total
}

/**
 * Gray out the text of a line that cannot be selected, unless it has colors of
 * its own.
 *
 * @param message - Text of the line.
 * @returns Text to draw.
 */
function dimUnlessColored(message: string): string {
  return hasColor(message) ? message : colors.gray(message)
}

/**
 * Join the parts of a line with spaces, leaving out the empty ones.
 *
 * @param parts - Pointer and mark, text, and hint of the line.
 * @returns Text of the line.
 */
function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Check whether a text has colors of its own.
 *
 * @param text - Text to check.
 * @returns True when it holds a color code.
 */
function hasColor(text: string): boolean {
  return stripAnsi(text) !== text
}
