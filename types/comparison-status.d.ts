/**
 * How a commit relates to a base, as GitHub compares them: `behind` or
 * `identical` when the history of the base contains the commit, `ahead` when
 * the commit descends from the base, `diverged` when each holds commits the
 * other lacks.
 */
export type ComparisonStatus = 'identical' | 'diverged' | 'behind' | 'ahead'
