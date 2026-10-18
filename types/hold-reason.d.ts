/**
 * Why an update was held back: the update mode, the downgrade guard, the
 * cool-down (`cool-down` for a release or a commit too recent, `age-unknown`
 * for an age that could not be established) or a trust check (`tag-moved`,
 * `unreachable-commit`).
 */
export type HoldReason =
  | 'unreachable-commit'
  | 'age-unknown'
  | 'tag-moved'
  | 'cool-down'
  | 'downgrade'
  | 'mode'
