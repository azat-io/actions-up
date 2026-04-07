/**
 * Minimal subset of CLI flags that require cross-option validation.
 */
interface ValidateCliOptionsInput {
  /**
   * Whether JSON report mode is enabled.
   */
  json?: boolean

  /**
   * Whether auto-apply mode is enabled.
   */
  yes?: boolean
}

/**
 * Validate combinations of CLI flags before running the pipeline.
 *
 * @param options - Parsed CLI flags relevant to cross-option validation.
 */
export function validateCliOptions(options: ValidateCliOptionsInput): void {
  if (options.json && options.yes) {
    throw new Error('--json cannot be used with --yes')
  }
}
