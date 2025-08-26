import pc from 'picocolors'

/**
 * Formats a version string for display, handling null/undefined values.
 *
 * @param version - Version string or null/undefined.
 * @returns Formatted version string or 'unknown' placeholder.
 */
export function formatVersion(version: undefined | string | null): string {
  return version ?? pc.gray('unknown')
}
