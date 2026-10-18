import semver from 'semver'

import type { GitHubClient } from '../../types/github-client'
import type { GitHubAction } from '../../types/github-action'
import type { ActionUpdate } from '../../types/action-update'
import type { UpdateStyle } from '../../types/update-style'
import type { TagInfo } from '../../types/tag-info'

import { selectLatestSemverTag } from '../versions/select-latest-semver-tag'
import { selectLatestFamilyTag } from '../versions/select-latest-family-tag'
import { parseVersionComment } from '../versions/parse-version-comment'
import { preserveTagFormat } from '../versions/preserve-tag-format'
import { isSameTagFamily } from '../versions/is-same-tag-family'
import { normalizeVersion } from '../versions/normalize-version'
import { getFamilyPrefix } from '../versions/get-family-prefix'
import { createGitHubClient } from './create-github-client'
import { isSemverLike } from '../versions/is-semver-like'
import { compareSha } from '../versions/compare-sha'
import { isSha } from '../versions/is-sha'

/**
 * Internal result for a single release/tag lookup, enriched with status info.
 */
interface ReleaseCheckResult extends LatestInfo {
  /**
   * Reason why lookup was skipped, if applicable.
   */
  skipReason?:
    | 'ref-type-unavailable'
    | 'check-failed'
    | 'tag-family'
    | 'not-found'
    | 'branch'

  /**
   * Failure the lookup ended with, reported once every lookup has finished so
   * the warnings come out in scan order.
   */
  failure?: { actionName: string; error: unknown }

  /**
   * Detected style of the current reference being evaluated.
   */
  currentRefType?: ActionUpdate['currentRefType']

  /**
   * Whether lookup succeeded or was skipped (e.g., branch ref).
   */
  status?: 'skipped' | 'ok'

  /**
   * Rate limit the lookup ran into.
   */
  rateLimitError?: Error

  /**
   * Lookup key this result belongs to (action name plus current reference).
   */
  actionKey: string
}

/**
 * Information about the latest version of an action.
 */
interface LatestInfo {
  /**
   * Publication date of the release of the latest version, null when the
   * version came from a tag listing, whose releases are looked up later and
   * only when the cool-down needs them.
   */
  publishedAt: Date | null

  /**
   * Latest version string.
   */
  version: string | null

  /**
   * Whether that release is immutable, unset when no release was read.
   */
  immutable?: boolean

  /**
   * Commit the tag of the latest version points at, read from the tag
   * reference; null when it could not be read.
   */
  sha: string | null
}

/**
 * Error thrown when the GitHub API rate limit is exceeded.
 */
class GitHubRateLimitError extends Error {
  /**
   * Create a rate limit error.
   *
   * @param message - Human-readable error message.
   * @param options - Optional error options (e.g., cause).
   */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GitHubRateLimitError'
  }
}

/**
 * Check for updates for GitHub Actions.
 *
 * @param actions - Array of GitHub Actions to check.
 * @param token - Optional GitHub token for authentication.
 * @param options - Additional options (e.g., include branch refs, shared
 *   client).
 * @returns Array of update information.
 */
export async function checkUpdates(
  actions: GitHubAction[],
  token?: string,
  options?: {
    includeBranches?: boolean
    client?: GitHubClient
    preferTags?: boolean
    style?: UpdateStyle
  },
): Promise<ActionUpdate[]> {
  let client = options?.client ?? createGitHubClient(token)
  let includeBranches = options?.includeBranches ?? false
  let preferTags = options?.preferTags ?? false
  let style = options?.style ?? 'sha'

  /**
   * Wider tag window when tags may compete with releases.
   */
  let tagFetchLimit = preferTags ? 100 : 30

  /**
   * Filter external actions and reusable workflows.
   */
  let externalActions = actions.filter(
    action => action.type === 'external' || action.type === 'reusable-workflow',
  )

  if (externalActions.length === 0) {
    return []
  }

  /**
   * Group by action name and current reference to avoid duplicate API calls
   * while keeping occurrences pinned to different references independent: they
   * resolve to different reference types and must not share a verdict.
   */
  let uniqueActions = new Map<string, GitHubAction[]>()

  for (let action of externalActions) {
    let key = buildActionKey(action)
    let group = uniqueActions.get(key) ?? []
    group.push(action)
    uniqueActions.set(key, group)
  }

  /**
   * Resolve the latest release/tag info for a single action occurrence.
   *
   * @param actionKey - Lookup key produced by `buildActionKey`.
   * @returns The resolved release/tag information for the action.
   */
  async function resolveAction(actionKey: string): Promise<ReleaseCheckResult> {
    let currentVersions = uniqueActions.get(actionKey)!
    let { name: actionName } = currentVersions[0]!

    /**
     * Parse owner/repo from actionName, which may include path.
     */
    let segments = actionName.split('/')
    if (segments.length < 2) {
      return {
        currentRefType: 'unknown',
        publishedAt: null,
        version: null,
        actionKey,
        sha: null,
      }
    }
    let [owner, repository] = segments

    if (!owner || !repository) {
      return {
        currentRefType: 'unknown',
        publishedAt: null,
        version: null,
        actionKey,
        sha: null,
      }
    }

    try {
      /**
       * First check if current versions are branches - if so, skip update check
       * unless explicitly allowed.
       */
      let firstVersion = currentVersions[0]?.version
      let currentReferenceType = deriveCurrentReferenceType(firstVersion)
      if (firstVersion && !isSha(firstVersion) && !isSemverLike(firstVersion)) {
        let referenceType: 'branch' | 'tag' | null
        try {
          referenceType = await client.getRefType(
            owner,
            repository,
            firstVersion,
          )
        } catch (error) {
          if (isRateLimitError(error)) {
            throw error
          }
          /**
           * A failed lookup is not an answer: the reference may well be a
           * branch, and pinning it would rewrite a floating reference the run
           * was never asked to touch. It is reported whether or not branches
           * are included, because nothing is known about it either way.
           */
          return {
            skipReason: 'ref-type-unavailable' as const,
            currentRefType: currentReferenceType,
            status: 'skipped' as const,
            publishedAt: null,
            version: null,
            actionKey,
            sha: null,
          }
        }
        currentReferenceType =
          referenceType === 'branch' || referenceType === 'tag' ?
            referenceType
          : currentReferenceType
        if (referenceType === 'branch' && !includeBranches) {
          /**
           * Skip update check for branch references.
           */
          return {
            currentRefType: currentReferenceType,
            skipReason: 'branch' as const,
            status: 'skipped' as const,
            publishedAt: null,
            version: null,
            actionKey,
            sha: null,
          }
        }
      }

      /**
       * A reference from a named tag family cannot be answered by the
       * repository release channel, which belongs to whichever family the
       * publisher releases from. Such families are resolved from their own tags
       * instead, in a single prefix-filtered request.
       */
      let familyReference = resolveFamilyReference(currentVersions[0]!)
      let familyPrefix =
        currentReferenceType === 'branch' ? null : (
          getFamilyPrefix(familyReference)
        )

      if (familyPrefix) {
        let familyTags = await client.getMatchingTagReferences(
          owner,
          repository,
          familyPrefix,
        )
        let best = selectLatestFamilyTag(familyTags, familyReference!)

        if (!best) {
          return {
            currentRefType: currentReferenceType,
            skipReason: 'tag-family' as const,
            status: 'skipped' as const,
            publishedAt: null,
            version: null,
            actionKey,
            sha: null,
          }
        }

        let latest = await resolveListedTag(client, {
          repo: repository,
          tag: best,
          owner,
        })

        return {
          currentRefType: currentReferenceType,
          status: 'ok' as const,
          actionKey,
          ...latest,
        }
      }

      /**
       * Get latest release first to minimize requests.
       */
      let release = await client.getLatestRelease(owner, repository)

      if (!release) {
        let allReleases = await client.getAllReleases(owner, repository, 1)
        let stableRelease = allReleases.find(
          currentRelease => !currentRelease.isPrerelease,
        )
        release = stableRelease ?? allReleases[0] ?? null
      }

      /**
       * If we have a release, prefer it and avoid tags, except when the release
       * tag looks like a moving major (e.g., v1). In that case, try tags to
       * find a more specific highest semver.
       */
      if (release) {
        let { publishedAt, immutable, version } = release
        let considerTags = false
        {
          /**
           * Consider tags when:
           *
           * - Tags are explicitly preferred (opt-in)
           * - Or release version is missing/empty
           * - Or it's a moving major (v1)
           * - Or it doesn't parse as valid semver after normalization.
           */
          let normalized = normalizeVersion(version)
          let hasVersion = Boolean(version && version.trim() !== '')
          let majorOnly = hasVersion && /^v?\d+$/u.test(version.trim())
          let valid = semver.valid(normalized)
          considerTags =
            preferTags ||
            !hasVersion ||
            majorOnly ||
            !valid ||
            !isSemverLike(version)
        }

        if (considerTags) {
          let tags = await client.getAllTags(owner, repository, tagFetchLimit)
          let latestSemverTag = selectLatestSemverTag(tags)

          if (latestSemverTag) {
            let best = latestSemverTag.tag
            let releaseSem = semver.valid(
              normalizeVersion(version) ?? undefined,
            )

            /**
             * If best tag is newer or same but more specific, prefer it.
             */
            if (
              !releaseSem ||
              semver.gt(latestSemverTag.version, releaseSem) ||
              (semver.eq(latestSemverTag.version, releaseSem) &&
                /\d+\.\d+/u.test(best.tag))
            ) {
              let latest = await resolveListedTag(client, {
                repo: repository,
                tag: best,
                owner,
              })
              return {
                currentRefType: currentReferenceType,
                actionKey,
                ...latest,
              }
            }
          }
        }

        /**
         * The commit comes from the tag reference alone. The release also names
         * one in `target_commitish`, but GitHub keeps that value when the tag
         * already existed or was moved later, so it can name a commit the tag
         * no longer runs.
         */
        let sha =
          version ?
            await resolveTagSha(client, {
              repo: repository,
              tag: version,
              owner,
            })
          : null
        return {
          currentRefType: currentReferenceType,
          status: 'ok' as const,
          publishedAt,
          immutable,
          actionKey,
          version,
          sha,
        }
      }

      /**
       * No releases found: fetch tags and choose the best semver tag.
       */
      let tags = await client.getAllTags(owner, repository, tagFetchLimit)
      if (tags.length > 0) {
        /**
         * Prefer the highest semver tag; among equal numeric versions, prefer
         * more specific (x.y.z over v1). When no tag carries a comparable
         * version, fall back to the first tag of the current family as returned
         * by the API (most recent by commit date).
         */
        let best =
          selectLatestSemverTag(tags)?.tag ??
          tags.find(tag => isSameTagFamily(firstVersion, tag.tag)) ??
          tags[0]!

        let latest = await resolveListedTag(client, {
          repo: repository,
          tag: best,
          owner,
        })
        return {
          currentRefType: currentReferenceType,
          status: 'ok' as const,
          actionKey,
          ...latest,
        }
      }

      return {
        currentRefType: currentReferenceType,
        publishedAt: null,
        version: null,
        actionKey,
        sha: null,
      }
    } catch (error: unknown) {
      /**
       * Handle rate limit errors specially.
       */
      if (error instanceof Error && error.name === 'GitHubRateLimitError') {
        /**
         * Don't log individual rate limit errors.
         */
        return {
          currentRefType: 'unknown',
          rateLimitError: error,
          publishedAt: null,
          version: null,
          actionKey,
          sha: null,
        }
      }
      /**
       * A 404 reaches here only from a repository listing, and GitHub answers
       * an existing repository with an empty list when there is nothing to
       * list. The repository itself is missing or hidden from the current
       * credentials, which the report names on its own rather than as a failure
       * with a stack trace.
       */
      if (isNotFoundError(error)) {
        return {
          skipReason: 'not-found' as const,
          status: 'skipped' as const,
          currentRefType: 'unknown',
          publishedAt: null,
          version: null,
          actionKey,
          sha: null,
        }
      }
      /**
       * Other failures are logged per action.
       */
      return {
        skipReason: 'check-failed' as const,
        failure: { actionName, error },
        status: 'skipped' as const,
        currentRefType: 'unknown',
        publishedAt: null,
        version: null,
        actionKey,
        sha: null,
      }
    }
  }

  /**
   * Every lookup starts at once. The client keeps the requests within its
   * limits, sends each one only once for lookups that share it, and refuses the
   * rest once a request runs into a rate limit.
   */
  let releaseResults = await Promise.all(
    uniqueActions.keys().map(actionKey => resolveAction(actionKey)),
  )

  for (let { failure } of releaseResults) {
    if (failure) {
      console.warn(`Failed to check ${failure.actionName}:`, failure.error)
    }
  }

  /**
   * If rate limit was hit, throw a user-friendly error.
   */
  let rateLimitError = releaseResults.find(
    result => result.rateLimitError,
  )?.rateLimitError

  if (rateLimitError) {
    let usingToken = Boolean(token ?? process.env['GITHUB_TOKEN'])
    let base = rateLimitError.message || 'GitHub API rate limit exceeded.'
    let message = `${base}\n${
      usingToken ?
        'Wait for reset or reduce request rate.'
      : 'Please set GITHUB_TOKEN environment variable to increase the limit.\n' +
        'See: https://github.com/azat-io/actions-up?tab=readme-ov-file#github-token'
    }`

    throw new GitHubRateLimitError(message)
  }

  /**
   * Create cache from results.
   */
  let cache = new Map<string, ReleaseCheckResult>()
  for (let result of releaseResults) {
    cache.set(result.actionKey, {
      currentRefType: result.currentRefType,
      publishedAt: result.publishedAt,
      skipReason: result.skipReason,
      immutable: result.immutable,
      actionKey: result.actionKey,
      version: result.version,
      status: result.status,
      sha: result.sha,
    })
  }

  /**
   * Create updates for all actions.
   */
  let updates: ActionUpdate[] = []

  for (let action of externalActions) {
    let cached = cache.get(buildActionKey(action))
    if (cached) {
      updates.push(
        createUpdate(
          action,
          {
            publishedAt: cached.publishedAt,
            immutable: cached.immutable,
            version: cached.version,
            sha: cached.sha,
          },
          {
            currentRefType: cached.currentRefType,
            skipReason: cached.skipReason,
            status: cached.status,
            style,
          },
        ),
      )
    } else {
      updates.push(
        createUpdate(
          action,
          { publishedAt: null, version: null, sha: null },
          {
            currentRefType: deriveCurrentReferenceType(action.version),
            style,
          },
        ),
      )
    }
  }

  return updates
}

/**
 * Create update information for an action.
 *
 * @param action - GitHub Action to check.
 * @param latest - Latest version info.
 * @param meta - Additional metadata (e.g., skip status/reason).
 * @returns Update information.
 */
function createUpdate(
  action: GitHubAction,
  latest: LatestInfo,
  meta: {
    currentRefType: ActionUpdate['currentRefType']
    skipReason?: ActionUpdate['skipReason']
    status?: ActionUpdate['status']
    style: UpdateStyle
  },
): ActionUpdate {
  let { version: latestVersion, sha: latestSha, publishedAt } = latest
  let immutableRelease = latest.immutable
  let currentVersionRaw = action.version ?? 'unknown'
  let currentVersion = normalizeVersion(currentVersionRaw)
  let currentReferenceType = meta.currentRefType
  let { style } = meta
  let preservedLatestVersion =
    style === 'preserve' && currentReferenceType === 'tag' ?
      preserveTagFormat(currentVersionRaw, latestVersion)
    : null
  let effectiveLatestVersion = preservedLatestVersion ?? latestVersion
  let normalized =
    effectiveLatestVersion ? normalizeVersion(effectiveLatestVersion) : null

  /**
   * Default status is ok unless explicitly marked skipped.
   */
  let status: ActionUpdate['status'] = meta.status ?? 'ok'
  let skipReason: ActionUpdate['skipReason'] = meta.skipReason

  /**
   * A repository can publish several disjoint tag families, and a candidate
   * from the wrong one resolves to an existing but unrelated commit, so the
   * reference is reported instead of rewritten. Branch refs keep their own
   * handling; SHA refs never reach this because they carry no family.
   */
  if (
    currentReferenceType !== 'branch' &&
    !isSameTagFamily(resolveFamilyReference(action), latestVersion)
  ) {
    status = 'skipped'
    skipReason = 'tag-family'
  }

  /**
   * A reference that carries no version at all (`nightly`, `latest`, a channel
   * tag) can only be compared as a string, and a string difference holds
   * between any two distinct tags, so it is no evidence of an update. Such a
   * pair is reported instead of rewritten. A branch keeps its own handling: it
   * floats by design and is only checked when the run opted into branches.
   */
  if (
    status !== 'skipped' &&
    normalized !== null &&
    currentReferenceType !== 'branch' &&
    !isComparablePair(currentVersion, normalized, isSha(currentVersionRaw))
  ) {
    status = 'skipped'
    skipReason = 'not-comparable'
  }

  let hasUpdate = false
  let isBreaking = false

  if (status !== 'skipped') {
    if (currentVersion && isSha(currentVersion)) {
      hasUpdate = latestSha !== null && !compareSha(currentVersion, latestSha)
    } else if (currentVersion && normalized) {
      let currentSemver = semver.valid(currentVersion)
      let latestSemver = semver.valid(normalized)

      if (currentSemver && latestSemver) {
        hasUpdate = semver.lt(currentSemver, latestSemver)

        if (hasUpdate) {
          let currentMajor = semver.major(currentSemver)
          let latestMajor = semver.major(latestSemver)
          isBreaking = latestMajor > currentMajor
        }
        /**
         * If versions are equal but current ref is an unpinned tag and latest
         * SHA is known, suggest pinning to SHA (or normalizing to the canonical
         * floating tag in semver style). A semver-style no-op is dropped later
         * when the resolved target matches the current reference.
         */
        if (
          !hasUpdate &&
          latestSha &&
          (style === 'sha' || style === 'semver') &&
          semver.eq(currentSemver, latestSemver) &&
          !isSha(action.version)
        ) {
          hasUpdate = true
          isBreaking = false
        }
      } else {
        /**
         * Only a branch reaches here, since the guard above reports every other
         * pair that cannot be read as versions. A branch carries no version to
         * compare against, so any reference other than the one in the file is
         * the move the run was asked to make.
         */
        hasUpdate = currentVersion !== normalized
      }
    }

    /**
     * Without the commit its tag points at, the latest version can be neither
     * compared with a SHA pin nor written, and no other commit stands in for
     * it. A tag reference already at the latest version needs neither.
     */
    if (latestVersion && !latestSha && (hasUpdate || isSha(currentVersion))) {
      status = 'skipped'
      skipReason = 'sha-unresolved'
      hasUpdate = false
      isBreaking = false
    }
  }

  return {
    currentRefType: currentReferenceType,
    currentVersion: currentVersionRaw,
    immutableRelease,
    latestVersion,
    publishedAt,
    isBreaking,
    skipReason,
    latestSha,
    hasUpdate,
    action,
    status,
  }
}

/**
 * Read the commit a tag points at from its tag reference.
 *
 * @param client - GitHub API client.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag name.
 * @returns Commit SHA, or null when the tag points at no commit or the lookup
 *   failed.
 * @throws GitHubRateLimitError - When the request was rate limited.
 */
async function resolveTagSha(
  client: GitHubClient,
  parameters: { owner: string; repo: string; tag: string },
): Promise<string | null> {
  let { owner, repo, tag } = parameters
  try {
    return await client.getTagSha(owner, repo, tag)
  } catch (error) {
    if (isRateLimitError(error)) {
      throw error
    }
    return null
  }
}

/**
 * Resolve the latest version information for a tag picked from a tag listing.
 *
 * GitHub derives the commit a listing names from the tag reference, so it is
 * taken as it is. An annotated tag listed by name prefix names its tag object
 * instead, and its commit is read from the tag reference. Dates are left to the
 * cool-down, which looks them up only for the versions it has to measure.
 *
 * @param client - GitHub API client.
 * @param parameters - Request parameters.
 * @param parameters.owner - Repository owner.
 * @param parameters.repo - Repository name.
 * @param parameters.tag - Tag picked from the listing.
 * @returns Version and commit SHA of the tag, without a publication date.
 * @throws GitHubRateLimitError - When a request was rate limited.
 */
async function resolveListedTag(
  client: GitHubClient,
  parameters: { owner: string; repo: string; tag: TagInfo },
): Promise<LatestInfo> {
  let { owner, repo, tag } = parameters
  let sha =
    tag.sha ?? (await resolveTagSha(client, { tag: tag.tag, owner, repo }))
  return { publishedAt: null, version: tag.tag, sha }
}

/**
 * Check whether the current and the latest reference can be compared as
 * versions at all.
 *
 * The latest reference has to carry a version, since it is what an update would
 * write. The current one has to carry a version as well, unless it is a SHA
 * pin, which is compared by commit instead.
 *
 * @param currentVersion - Normalized reference used in the file.
 * @param latestVersion - Normalized reference an update would write.
 * @param isShaPin - Whether the current reference is a commit SHA.
 * @returns True when the two references can be compared.
 */
function isComparablePair(
  currentVersion: string | null,
  latestVersion: string,
  isShaPin: boolean,
): boolean {
  if (!semver.valid(latestVersion)) {
    return false
  }

  if (isShaPin) {
    return true
  }

  return Boolean(currentVersion && semver.valid(currentVersion))
}

function deriveCurrentReferenceType(
  version: undefined | string | null,
): ActionUpdate['currentRefType'] {
  if (!version) {
    return 'unknown'
  }

  if (isSha(version)) {
    return 'sha'
  }

  if (isSemverLike(version)) {
    return 'tag'
  }

  return 'unknown'
}

/**
 * Resolve the reference whose tag family should drive the lookup.
 *
 * A SHA carries no family of its own, so the version comment written next to it
 * is used instead: it is the only record of which tag, and therefore which
 * family, the pin came from.
 *
 * @param action - Action occurrence found during the scan.
 * @returns Reference to derive the tag family from, or null when unknown.
 */
function resolveFamilyReference(action: GitHubAction): string | null {
  let { version } = action

  if (version && isSha(version)) {
    return parseVersionComment(action.comment)
  }

  return version ?? null
}

function isRateLimitError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'GitHubRateLimitError'
}

/**
 * Recognize the error a lookup fails with when GitHub answers with a 404.
 *
 * @param error - Error thrown by a lookup.
 * @returns True when the request was answered with a 404.
 */
function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 404
}

/**
 * Build the lookup key of a single action occurrence.
 *
 * Occurrences of one action pinned at different references are checked
 * independently, so the current reference is part of the key.
 *
 * @param action - Action occurrence found during the scan.
 * @returns Key combining the action name and its current reference.
 */
function buildActionKey(action: GitHubAction): string {
  return `${action.name}@${action.version ?? ''}`
}
