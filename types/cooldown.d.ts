/**
 * Release age cool-down applied to an action.
 */
export interface Cooldown {
  /**
   * Minimum age of a version in milliseconds.
   */
  minAgeMs: number

  /**
   * Moment the age is measured at, in milliseconds since the epoch.
   */
  now: number
}
