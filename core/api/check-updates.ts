import semver from 'semver'

import type { GitHubAction } from '../../types/github-action'
import type { ActionUpdate } from '../../types/action-update'

import { createGitHubClient } from './create-github-client'

/**
 * Check for updates for GitHub Actions.
 *
 * @param actions - Array of GitHub Actions to check.
 * @param token - Optional GitHub token for authentication.
 * @returns Array of update information.
 */
export async function checkUpdates(
  actions: GitHubAction[],
  token?: string,
): Promise<ActionUpdate[]> {
  let client = createGitHubClient(token)

  /** Filter only external actions. */
  let externalActions = actions.filter(action => action.type === 'external')

  if (externalActions.length === 0) {
    return []
  }

  /** Group by action name to avoid duplicate API calls. */
  let uniqueActions = new Map<string, GitHubAction[]>()

  for (let action of externalActions) {
    let group = uniqueActions.get(action.name) ?? []
    group.push(action)
    uniqueActions.set(action.name, group)
  }

  /** Track rate limit errors with shared state. */
  let sharedState = {
    rateLimitError: null as Error | null,
    rateLimitHit: false,
  }

  /** Fetch releases sequentially to stop on rate limit. */
  let releaseResults = await [...uniqueActions.keys()].reduce(
    (promise, actionName) =>
      promise.then(async results => {
        /** Skip remaining if rate limit hit. */
        if (sharedState.rateLimitHit) {
          return [...results, { version: null, actionName, sha: null }]
        }

        /** Parse owner/repo from actionName, which may include path. */
        let segments = actionName.split('/')
        if (segments.length < 2) {
          return [...results, { version: null, actionName, sha: null }]
        }
        let [owner, repo] = segments

        if (!owner || !repo) {
          return [...results, { version: null, actionName, sha: null }]
        }

        try {
          /**
           * First check if current versions are branches - if so, skip update
           * check.
           */
          let currentVersions = uniqueActions.get(actionName)!
          let firstVersion = currentVersions[0]?.version
          if (
            firstVersion &&
            !isSha(firstVersion) &&
            !isSemverLike(firstVersion)
          ) {
            let referenceType = await client.getRefType(
              owner,
              repo,
              firstVersion,
            )
            if (referenceType === 'branch') {
              /** Skip update check for branch references. */
              return [...results, { version: null, actionName, sha: null }]
            }
          }

          /** Get latest release first to minimize requests. */
          let release = await client.getLatestRelease(owner, repo)

          if (!release) {
            let allReleases = await client.getAllReleases(owner, repo, 1)
            let stableRelease = allReleases.find(
              currentRelease => !currentRelease.isPrerelease,
            )
            release = stableRelease ?? allReleases[0] ?? null
          }

          /**
           * If we have a release, prefer it and avoid tags, except when the
           * release tag looks like a moving major (e.g., v1). In that case, try
           * tags to find a more specific highest semver.
           */
          if (release) {
            let { version, sha } = release
            let considerTags = false
            {
              /**
               * Consider tags when:
               *
               * - Release version is missing/empty
               * - Or it's a moving major (v1)
               * - Or it doesn't parse as valid semver after normalization.
               */
              let normalized = normalizeVersion(version)
              let hasVersion = Boolean(version && version.trim() !== '')
              let majorOnly = hasVersion && /^v?\d+$/u.test(version.trim())
              let valid = semver.valid(normalized)
              considerTags = !hasVersion || majorOnly || !valid
            }

            if (considerTags) {
              let tags = await client.getAllTags(owner, repo, 30)
              if (tags.length > 0) {
                let semverCandidates = tags
                  .filter(tag => isSemverLike(tag.tag))
                  .map(tag => ({
                    v: semver.valid(normalizeVersion(tag.tag))!,
                    raw: tag,
                  }))

                if (semverCandidates.length > 0) {
                  /** Sort desc; tie-break to prefer more specific (x.y.z). */
                  semverCandidates.sort((a, b) => {
                    let cmp = semver.rcompare(a.v, b.v)
                    if (cmp !== 0) {
                      return cmp
                    }
                    let aSpecific = /\d+\.\d+/u.test(a.raw.tag) ? 1 : 0
                    let bSpecific = /\d+\.\d+/u.test(b.raw.tag) ? 1 : 0
                    return bSpecific - aSpecific
                  })

                  let best = semverCandidates[0]!.raw
                  let releaseSem = semver.valid(
                    normalizeVersion(version) ?? undefined,
                  )

                  /** If best tag is newer or same but more specific, prefer it. */
                  if (
                    !releaseSem ||
                    semver.gt(semverCandidates[0]!.v, releaseSem) ||
                    (semver.eq(semverCandidates[0]!.v, releaseSem) &&
                      /\d+\.\d+/u.test(best.tag))
                  ) {
                    let tagVersion = best.tag
                    let tagSha = best.sha?.length ? best.sha : null
                    if (!tagSha && tagVersion) {
                      try {
                        tagSha = await client.getTagSha(owner, repo, tagVersion)
                      } catch {}
                    }
                    return [
                      ...results,
                      { version: tagVersion, sha: tagSha, actionName },
                    ]
                  }
                }
              }
            }

            if (!sha && version) {
              try {
                sha = await client.getTagSha(owner, repo, version)
              } catch {
                /** Ignore SHA fetch errors. */
              }
            }
            return [...results, { actionName, version, sha }]
          }

          /** No releases found: fetch tags and choose the best semver tag. */
          let tags = await client.getAllTags(owner, repo, 30)
          if (tags.length > 0) {
            /**
             * Prefer the highest semver tag; among equal numeric versions,
             * prefer more specific (x.y.z over v1). If no semver-like tags,
             * fallback to the first tag as returned by the API (most recent by
             * commit date).
             */
            let semverCandidates = tags
              .filter(tag => isSemverLike(tag.tag))
              .map(tag => ({
                v: semver.valid(normalizeVersion(tag.tag))!,
                raw: tag,
              }))

            let best: (typeof tags)[number]
            if (semverCandidates.length > 0) {
              semverCandidates.sort((a, b) => {
                let cmp = semver.rcompare(a.v, b.v)
                if (cmp !== 0) {
                  return cmp
                }
                /** Tie-breaker: prefer more specific tags containing a dot. */
                let aSpecific = /\d+\.\d+/u.test(a.raw.tag) ? 1 : 0
                let bSpecific = /\d+\.\d+/u.test(b.raw.tag) ? 1 : 0
                return bSpecific - aSpecific
              })
              best = semverCandidates[0]!.raw
            } else {
              best = tags[0]!
            }

            let version = best.tag
            let sha = best.sha?.length ? best.sha : null
            if (!sha && version) {
              try {
                sha = await client.getTagSha(owner, repo, version)
              } catch {
                /** Ignore SHA fetch errors. */
              }
            }
            return [...results, { actionName, version, sha }]
          }

          return [...results, { version: null, actionName, sha: null }]
        } catch (error: unknown) {
          /** Handle rate limit errors specially. */
          if (error instanceof Error && error.name === 'GitHubRateLimitError') {
            sharedState.rateLimitHit = true
            sharedState.rateLimitError = error
            /** Don't log individual rate limit errors. */
            return [...results, { version: null, actionName, sha: null }]
          }
          /** Log other failures per action. */
          console.warn(`Failed to check ${actionName}:`, error)
          return [...results, { version: null, actionName, sha: null }]
        }
      }),
    Promise.resolve(
      [] as {
        version: string | null
        actionName: string
        sha: string | null
      }[],
    ),
  )

  /** If rate limit was hit, throw a user-friendly error. */
  if (sharedState.rateLimitError) {
    let usingToken = Boolean(token ?? process.env['GITHUB_TOKEN'])
    let base =
      sharedState.rateLimitError.message || 'GitHub API rate limit exceeded.'
    let message = `${base}\n${
      usingToken
        ? 'Wait for reset or reduce request rate.'
        : 'Please set GITHUB_TOKEN environment variable to increase the limit.\n' +
          'See: https://github.com/azat-io/actions-up?tab=readme-ov-file#using-github-token-for-higher-rate-limits'
    }`

    let error = new Error(message)
    error.name = 'GitHubRateLimitError'
    throw error
  }

  /** Create cache from results. */
  let cache = new Map<string, { version: string | null; sha: string | null }>()
  for (let result of releaseResults) {
    cache.set(result.actionName, {
      version: result.version,
      sha: result.sha,
    })
  }

  /** Create updates for all actions. */
  let updates: ActionUpdate[] = []

  for (let action of externalActions) {
    let cached = cache.get(action.name)
    if (cached) {
      updates.push(createUpdate(action, cached.version, cached.sha))
    } else {
      updates.push(createUpdate(action, null, null))
    }
  }

  return updates
}

/**
 * Create update information for an action.
 *
 * @param action - GitHub Action to check.
 * @param latestVersion - Latest available version.
 * @param latestSha - SHA hash of the latest version.
 * @returns Update information.
 */
function createUpdate(
  action: GitHubAction,
  latestVersion: string | null,
  latestSha: string | null,
): ActionUpdate {
  let currentVersion = normalizeVersion(action.version ?? '')
  let normalized = latestVersion ? normalizeVersion(latestVersion) : null

  let hasUpdate = false
  let isBreaking = false

  if (currentVersion && isSha(currentVersion)) {
    if (latestSha) {
      hasUpdate = !compareSha(currentVersion, latestSha)
    } else if (normalized) {
      hasUpdate = true
    }
  } else if (currentVersion && normalized) {
    let current = semver.valid(currentVersion)
    let latest = semver.valid(normalized)

    if (current && latest) {
      hasUpdate = semver.lt(current, latest)

      if (hasUpdate) {
        let currentMajor = semver.major(current)
        let latestMajor = semver.major(latest)
        isBreaking = latestMajor > currentMajor
      }
      /**
       * If versions are equal but current ref is an unpinned tag and latest SHA
       * is known, suggest pinning to SHA.
       */
      if (
        !hasUpdate &&
        semver.eq(current, latest) &&
        !isSha(action.version) &&
        latestSha
      ) {
        hasUpdate = true
        isBreaking = false
      }
    } else if (currentVersion !== normalized) {
      hasUpdate = true
    }
  }

  return {
    currentVersion: action.version ?? 'unknown',
    latestVersion,
    isBreaking,
    latestSha,
    hasUpdate,
    action,
  }
}

/**
 * Compare two SHA hashes, accounting for short and long formats.
 *
 * @param sha1 - First SHA hash.
 * @param sha2 - Second SHA hash.
 * @returns True if the SHAs refer to the same commit.
 */
function compareSha(sha1: string, sha2: string): boolean {
  /** Normalize by removing 'v' prefix if present. */
  let normalized1 = sha1.replace(/^v/u, '')
  let normalized2 = sha2.replace(/^v/u, '')

  /** If one SHA is shorter, compare only the common prefix. */
  let minLength = Math.min(normalized1.length, normalized2.length)

  /** Both must be at least 7 characters (minimum SHA length). */
  if (minLength < 7) {
    return false
  }

  /** Compare the common prefix. */
  return (
    normalized1.slice(0, Math.max(0, minLength)).toLowerCase() ===
    normalized2.slice(0, Math.max(0, minLength)).toLowerCase()
  )
}

/**
 * Normalize version string.
 *
 * @param version - Version string to normalize.
 * @returns Normalized version or null if empty.
 */
function normalizeVersion(version: string): string | null {
  if (!version) {
    return null
  }

  let normalized = version.replace(/^v/u, '')

  if (/^[0-9a-f]{7,40}$/iu.test(normalized)) {
    return version
  }

  /** Try to coerce to semver. */
  let coerced = semver.coerce(normalized)
  if (coerced) {
    return coerced.version
  }

  return version
}

/**
 * Check if a string is a Git SHA hash.
 *
 * @param value - String to check.
 * @returns True if the string is a SHA hash.
 */
function isSha(value: undefined | string | null): boolean {
  if (!value) {
    return false
  }

  /** Remove 'v' prefix if present. */
  let normalized = value.replace(/^v/u, '')

  /** Check if it matches SHA pattern (7-40 hex characters). */
  return /^[0-9a-f]{7,40}$/iu.test(normalized)
}

/**
 * Check if a string looks like a semver-like tag (with optional leading 'v').
 * Examples: v1, v2.3, 3.4.5.
 *
 * @param value - String to test for semver-like pattern.
 * @returns True if the value matches a simple semver-like pattern.
 */
function isSemverLike(value: undefined | string | null): boolean {
  if (!value) {
    return false
  }
  let normalized = value.trim()
  return /^v?\d+(?:\.\d+){0,2}$/u.test(normalized)
}
