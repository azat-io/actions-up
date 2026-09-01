/**
 * Decomposition of a tag name into the family it belongs to and the version it
 * carries.
 *
 * A tag family is the literal text preceding the numeric version core, so
 * `actions-v0.1.1` belongs to the `actions-v` family while `v0.2.3` and `0.2.3`
 * carry no family prefix beyond an optional `v`.
 */
export interface TagFamily {
  /**
   * Number of numeric segments in the core: 1 for `v1`, 3 for `v1.2.3`.
   */
  specificity: number

  /**
   * Semver prerelease or build metadata attached to the core, including the
   * leading delimiter (e.g. `-rc.1`, `+build.5`). Empty when absent.
   */
  qualifier: string

  /**
   * Comparable semver built from the core and the qualifier, with the core
   * padded to three segments (e.g. `1.0.0`, `1.2.3-rc.1`). Build metadata is
   * dropped here because semver ignores it when ordering versions; the raw form
   * stays on `qualifier`.
   */
  version: string

  /**
   * Literal text preceding the numeric core (e.g. `actions-v`, `v`, ``).
   */
  prefix: string

  /**
   * Numeric core exactly as written (e.g. `0.1`, `1.2.3`).
   */
  core: string
}
