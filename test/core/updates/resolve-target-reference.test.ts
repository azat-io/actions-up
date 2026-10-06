import { describe, expect, it, vi } from 'vitest'

import type { ActionUpdate } from '../../../types/action-update'
import type { GitHubClient } from '../../../types/github-client'

import { resolveTargetReference } from '../../../core/updates/resolve-target-reference'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createMockClient } from '../../helpers/create-mock-client'

const LATEST_SHA = 'bc3cc36289903834579013e80440bc6f0496dd60'

const CURRENT_SHA = '5245bb3a57d8065e44bd3911ee4f2a1db02d364e'

/**
 * Update entry for `actions/checkout` from `v4` to `v5.0.0`.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh update entry.
 */
function makeUpdate(overrides: Partial<ActionUpdate> = {}): ActionUpdate {
  return {
    action: { name: 'actions/checkout', type: 'external', version: 'v4' },
    latestVersion: 'v5.0.0',
    currentRefType: 'tag',
    latestSha: LATEST_SHA,
    currentVersion: 'v4',
    isBreaking: false,
    publishedAt: null,
    hasUpdate: true,
    ...overrides,
  }
}

/**
 * Client of a repository in which the given floating tags point at the latest
 * release and every other tag is missing.
 *
 * @param tags - Floating tags that exist.
 * @returns Mocked GitHub client.
 */
function clientWithFloatingTags(...tags: string[]): GitHubClient {
  return createMockClient({
    getTagSha: vi.fn((_owner: string, _repo: string, tag: string) =>
      Promise.resolve(tags.includes(tag) ? LATEST_SHA : null),
    ),
  })
}

/**
 * Client whose tag lookups are all rate limited, so a lookup that was not
 * expected shows up as a rate-limited result.
 *
 * @returns Mocked GitHub client.
 */
function rateLimitedClient(): GitHubClient {
  return createMockClient({
    getTagSha: vi
      .fn()
      .mockRejectedValue(
        new GitHubRateLimitError(new Date('2026-10-03T14:37:21.000Z')),
      ),
  })
}

describe('resolveTargetReference', () => {
  it('writes the latest SHA in sha style', async () => {
    let update = makeUpdate()

    let result = await resolveTargetReference(update, {
      client: clientWithFloatingTags('v5'),
      style: 'sha',
    })

    expect(result).toStrictEqual({
      ...update,
      targetRef: LATEST_SHA,
      targetRefStyle: 'sha',
    })
  })

  it('writes nothing in sha style when the latest SHA is unknown', async () => {
    let update = makeUpdate({ latestSha: null })

    let result = await resolveTargetReference(update, {
      client: clientWithFloatingTags('v5'),
      style: 'sha',
    })

    expect(result).toStrictEqual({
      ...update,
      targetRefStyle: null,
      targetRef: null,
    })
  })

  it.each(['preserve', 'semver'] as const)(
    'keeps a SHA reference on the latest SHA in %s style',
    async style => {
      let update = makeUpdate({
        currentVersion: CURRENT_SHA,
        currentRefType: 'sha',
      })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v5'),
        style,
      })

      expect(result).toStrictEqual({
        ...update,
        targetRef: LATEST_SHA,
        targetRefStyle: 'sha',
      })
    },
  )

  it('writes nothing for a SHA reference when the latest SHA is unknown', async () => {
    let update = makeUpdate({
      currentVersion: CURRENT_SHA,
      currentRefType: 'sha',
      latestSha: null,
    })

    let result = await resolveTargetReference(update, {
      client: clientWithFloatingTags('v5'),
      style: 'preserve',
    })

    expect(result).toStrictEqual({
      ...update,
      targetRefStyle: null,
      targetRef: null,
    })
  })

  it('writes nothing when there is no update', async () => {
    let update = makeUpdate({ hasUpdate: false })

    let result = await resolveTargetReference(update, {
      client: clientWithFloatingTags('v5'),
      style: 'preserve',
    })

    expect(result).toStrictEqual({
      ...update,
      targetRefStyle: null,
      targetRef: null,
    })
  })

  it('writes nothing for a branch reference', async () => {
    let update = makeUpdate({
      currentRefType: 'branch',
      currentVersion: 'main',
    })

    let result = await resolveTargetReference(update, {
      client: clientWithFloatingTags('v5'),
      style: 'preserve',
    })

    expect(result).toStrictEqual({
      ...update,
      targetRefStyle: null,
      targetRef: null,
    })
  })

  describe('in preserve style', () => {
    it('keeps the major-only granularity of the current tag', async () => {
      let update = makeUpdate({ latestVersion: 'v5.0.0', currentVersion: 'v4' })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v5.0', 'v5'),
        style: 'preserve',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v5',
      })
    })

    it('keeps the minor granularity of the current tag', async () => {
      let update = makeUpdate({
        latestVersion: 'v4.2.3',
        currentVersion: 'v4.1',
      })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v4.2', 'v4'),
        style: 'preserve',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v4.2',
      })
    })

    it('writes the latest version as is, without looking up tags, when it already has the granularity of the current tag', async () => {
      let update = makeUpdate({
        currentVersion: 'v4.2.1',
        latestVersion: 'v4.2.3',
      })

      let result = await resolveTargetReference(update, {
        client: rateLimitedClient(),
        style: 'preserve',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefStyle: 'tag',
        targetRef: 'v4.2.3',
      })
    })

    it('writes nothing when the current tag is more specific than the latest version', async () => {
      let update = makeUpdate({ currentVersion: 'v4.1', latestVersion: 'v5' })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v5'),
        style: 'preserve',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefStyle: null,
        targetRef: null,
      })
    })

    it('writes nothing when the current version is unknown', async () => {
      let update = makeUpdate({ currentVersion: null })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v5'),
        style: 'preserve',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefStyle: null,
        targetRef: null,
      })
    })
  })

  describe('in semver style', () => {
    it('rewrites to the major floating tag in major mode', async () => {
      let update = makeUpdate({
        currentVersion: 'v4.2.1',
        latestVersion: 'v7.0.1',
      })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v7.0', 'v7'),
        style: 'semver',
        mode: 'major',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v7',
      })
    })

    it('rewrites to the minor floating tag in patch mode', async () => {
      let update = makeUpdate({
        currentVersion: 'v4.2.1',
        latestVersion: 'v4.2.3',
      })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v4.2', 'v4'),
        style: 'semver',
        mode: 'patch',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v4.2',
      })
    })

    it('rewrites to the major floating tag when no mode is given', async () => {
      let update = makeUpdate({ latestVersion: 'v7.0.1', currentVersion: 'v4' })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v7.0', 'v7'),
        style: 'semver',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v7',
      })
    })

    it('writes a major-only latest version as is, without looking up tags', async () => {
      let update = makeUpdate({ currentVersion: 'v5.1.0', latestVersion: 'v6' })

      let result = await resolveTargetReference(update, {
        client: rateLimitedClient(),
        style: 'semver',
        mode: 'major',
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v6',
      })
    })
  })

  it.each(['preserve', 'semver'] as const)(
    'falls back to the exact latest version in %s style when no floating tag exists',
    async style => {
      let update = makeUpdate({ latestVersion: 'v8.3.2', currentVersion: 'v7' })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags(),
        style,
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v8.3.2',
      })
    },
  )

  it.each(['preserve', 'semver'] as const)(
    'marks the fallback in %s style as rate limited when the tag lookups are rate limited',
    async style => {
      let update = makeUpdate({ latestVersion: 'v8.3.2', currentVersion: 'v7' })

      let result = await resolveTargetReference(update, {
        client: rateLimitedClient(),
        style,
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: true,
        targetRefStyle: 'tag',
        targetRef: 'v8.3.2',
      })
    },
  )

  it.each(['preserve', 'semver'] as const)(
    'falls back to the exact latest version in %s style when the latest SHA is unknown',
    async style => {
      let update = makeUpdate({
        latestVersion: 'v8.3.2',
        currentVersion: 'v7',
        latestSha: null,
      })

      let result = await resolveTargetReference(update, {
        client: clientWithFloatingTags('v8'),
        style,
      })

      expect(result).toStrictEqual({
        ...update,
        targetRefRateLimited: false,
        targetRefStyle: 'tag',
        targetRef: 'v8.3.2',
      })
    },
  )
})
