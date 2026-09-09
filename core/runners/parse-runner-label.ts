import type { RunnerFamily } from './known-runner-labels'

import { KNOWN_RUNNER_IMAGES } from './known-runner-labels'

/**
 * A `runs-on` label resolved to a known GitHub-hosted runner image.
 */
interface ParsedRunnerLabel {
  /**
   * Runner family the label belongs to.
   */
  family: RunnerFamily

  /**
   * Version part of the label (e.g. `24.04` for `ubuntu-24.04`).
   */
  version: string
}

/**
 * Matches a bare GitHub-hosted runner label such as `ubuntu-24.04`.
 *
 * Anchored on both ends so suffixed labels (`ubuntu-24.04-arm`,
 * `macos-15-large`), floating aliases (`ubuntu-latest`), self-hosted labels and
 * expressions (`${{ matrix.os }}`) never match.
 */
const RUNNER_LABEL_PATTERN =
  /^(?<family>macos|ubuntu|windows)-(?<version>\d+(?:\.\d+)?)$/u

/**
 * Parses a `runs-on` value into a known GitHub-hosted runner image.
 *
 * @example
 *
 * ```ts
 * parseRunnerLabel('ubuntu-22.04') // { family: 'ubuntu', version: '22.04' }
 * parseRunnerLabel('ubuntu-latest') // null
 * ```
 *
 * @param label - Raw `runs-on` value to parse.
 * @returns Parsed label, or null when it is not a known runner image.
 */
export function parseRunnerLabel(label: string): ParsedRunnerLabel | null {
  let match = RUNNER_LABEL_PATTERN.exec(label)
  if (!match?.groups) {
    return null
  }

  let family = match.groups['family'] as RunnerFamily
  let version = match.groups['version']!

  /**
   * An unknown version is left alone rather than guessed at: the label may
   * belong to a retired image, a typo, or an image released after this table
   * was last updated.
   */
  let isKnown = KNOWN_RUNNER_IMAGES[family].some(
    image => image.version === version,
  )
  if (!isKnown) {
    return null
  }

  return { version, family }
}
