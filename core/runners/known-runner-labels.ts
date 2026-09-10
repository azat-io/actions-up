/**
 * A GitHub-hosted runner image known to Actions Up.
 */
export interface RunnerImage {
  /**
   * Whether the image is still in preview.
   *
   * Preview images carry no SLA, so they are never offered as update targets.
   */
  preview?: boolean

  /**
   * Version part of the runner label (e.g. `24.04` for `ubuntu-24.04`).
   */
  version: string
}

/**
 * Families of GitHub-hosted runners recognized by Actions Up.
 */
export type RunnerFamily = 'windows' | 'ubuntu' | 'macos'

/**
 * Known GitHub-hosted runner images per family, ordered oldest first.
 *
 * Mirrors the image table of `actions/runner-images`. GitHub keeps at most two
 * generally available images plus one preview image per family, so this table
 * stays small; update it whenever an image reaches general availability or is
 * retired.
 *
 * Only plain x64/arm64 labels without suffixes are listed. Sized macOS labels
 * (`-large`, `-xlarge`, `-intel`), Arm variants (`-arm`) and Visual Studio
 * variants (`-vs2026`) are deliberately absent, so they are never rewritten.
 *
 * @see https://github.com/actions/runner-images
 */
export const KNOWN_RUNNER_IMAGES: Record<RunnerFamily, RunnerImage[]> = {
  ubuntu: [
    { version: '22.04' },
    { version: '24.04' },
    { version: '26.04', preview: true },
  ],
  macos: [{ version: '14' }, { version: '15' }, { version: '26' }],
  windows: [{ version: '2022' }, { version: '2025' }],
}
