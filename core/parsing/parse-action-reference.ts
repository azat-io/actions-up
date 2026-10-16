import type { GitHubAction } from '../../types/github-action'

/**
 * Parses a GitHub Action reference string and returns a structured GitHubAction
 * object.
 *
 * @example
 *
 * ```ts
 * const action = parseActionReference(
 *   'actions/checkout@v3',
 *   'workflow.yml',
 *   10,
 * )
 * // Returns:
 * // {
 * //   type: 'external',
 * //   name: 'actions/checkout',
 * //   version: 'v3',
 * //   uses: 'actions/checkout@v3',
 * //   ref: 'actions/checkout@v3',
 * //   file: 'workflow.yml',
 * //   line: 10,
 * // }
 * ```
 *
 * @param reference - The action reference string to parse. Can be:
 *
 *   - External action: "owner/repo@version" (e.g., "actions/checkout@v3")
 *   - Reusable workflow: "owner/repo/path/to/workflow.yml@version", where the
 *       version may itself contain `@` (e.g., "ci@v1.0.0")
 *   - Local action: "./path/to/action" or "../path/to/action"
 *   - Docker action: "docker://image:tag".
 *
 * @param file - The file path where this action reference was found.
 * @param line - The line number where this action reference was found.
 * @returns A GitHubAction object if parsing succeeds, null otherwise.
 */
export function parseActionReference(
  reference: string,
  file: string,
  line: number,
): GitHubAction | null {
  if (!reference || reference.trim() === '') {
    return null
  }

  /**
   * Handle docker actions.
   */
  if (reference.startsWith('docker://')) {
    return {
      version: undefined,
      uses: reference,
      name: reference,
      type: 'docker',
      file,
      line,
    }
  }

  /**
   * Handle local actions.
   */
  if (reference.startsWith('./') || reference.startsWith('../')) {
    return {
      version: undefined,
      uses: reference,
      name: reference,
      type: 'local',
      file,
      line,
    }
  }

  /**
   * Handle external actions, supporting owner/repo or owner/repo/path. GitHub
   * splits the reference at its first `@`, so the version keeps any `@` that
   * follows, as in the `ci@v1.0.0` tags of monorepo release tools.
   */
  let [namePart, ...versionParts] = reference.split('@')
  let version = versionParts.join('@')
  if (!namePart || !version) {
    return null
  }

  /**
   * Validate owner/repo(/path...) format.
   */
  let segs = namePart.split('/')
  if (segs.length < 2) {
    return null
  }
  let [owner, repository] = segs
  if (!owner || !repository) {
    return null
  }

  for (let seg of segs.slice(2)) {
    if (!seg) {
      return null
    }
  }

  /**
   * Detect Reusable Workflows by checking for .yml/.yaml extensions.
   */
  let isReusableWorkflow =
    segs.length > 2 && (namePart.endsWith('.yml') || namePart.endsWith('.yaml'))

  /**
   * GitHub accepts a version containing `@` only in a reusable workflow
   * reference. A step that names an action such as `actions/checkout@v4@main`
   * fails workflow validation.
   */
  if (!isReusableWorkflow && version.includes('@')) {
    return null
  }

  return {
    type: isReusableWorkflow ? 'reusable-workflow' : 'external',
    ref: `${owner}/${repository}@${version}`,
    uses: reference,
    name: namePart,
    version,
    file,
    line,
  }
}
