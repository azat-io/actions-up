import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

import { selectExistingTagReference } from '../../core/updates/select-existing-tag-reference'
import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { createMockClient } from '../helpers/create-mock-client'

const LATEST_SHA = '3b1f9d770a89ffb6bbcf07a1c78a6f2c564ab1c2'

const STALE_SHA = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12'

/**
 * `getTagSha` that answers from a table of tag lookups.
 *
 * @param answers - Tag name mapped to the SHA it points at, or to the error its
 *   lookup fails with.
 * @returns Mocked `getTagSha` answering null for any other tag.
 */
function tagShas(
  answers: Record<string, string | Error>,
): GitHubClient['getTagSha'] {
  return vi.fn((_owner: string, _repo: string, tag: string) => {
    let answer = answers[tag]
    return answer instanceof Error ?
        Promise.reject(answer)
      : Promise.resolve(answer ?? null)
  })
}

describe('selectExistingTagReference', () => {
  it('returns floating tag when it exists and points at the latest release', async () => {
    let client = createMockClient({ getTagSha: tagShas({ v8: LATEST_SHA }) })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      latestSha: LATEST_SHA,
      candidates: ['v8'],
    })

    expect(result).toStrictEqual({ rateLimited: false, reference: 'v8' })
    expect(client.getTagSha).toHaveBeenCalledExactlyOnceWith(
      'owner',
      'repo',
      'v8',
    )
  })

  it('falls back to the exact latest version when no floating tag exists', async () => {
    let client = createMockClient({ getTagSha: tagShas({}) })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      latestSha: LATEST_SHA,
      candidates: ['v8'],
    })

    expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: false })
  })

  it('prefers the most specific candidate when several point at the latest release', async () => {
    let client = createMockClient({
      getTagSha: tagShas({ 'v6.2': LATEST_SHA, v6: LATEST_SHA }),
    })

    let result = await selectExistingTagReference(client, {
      candidates: ['v6.2', 'v6'],
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      latestSha: LATEST_SHA,
    })

    expect(result).toStrictEqual({ rateLimited: false, reference: 'v6.2' })
  })

  it('prefers a broader floating tag when the specific one is missing', async () => {
    let client = createMockClient({ getTagSha: tagShas({ v6: LATEST_SHA }) })

    let result = await selectExistingTagReference(client, {
      candidates: ['v6.2', 'v6'],
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      latestSha: LATEST_SHA,
    })

    expect(result).toStrictEqual({ rateLimited: false, reference: 'v6' })
    expect(client.getTagSha).toHaveBeenCalledWith('owner', 'repo', 'v6.2')
    expect(client.getTagSha).toHaveBeenCalledWith('owner', 'repo', 'v6')
  })

  it('prefers a broader floating tag when the specific one is stale', async () => {
    let client = createMockClient({
      getTagSha: tagShas({ 'v6.2': STALE_SHA, v6: LATEST_SHA }),
    })

    let result = await selectExistingTagReference(client, {
      candidates: ['v6.2', 'v6'],
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      latestSha: LATEST_SHA,
    })

    expect(result).toStrictEqual({ rateLimited: false, reference: 'v6' })
  })

  it('skips a floating tag that does not point at the latest release', async () => {
    let client = createMockClient({ getTagSha: tagShas({ v8: STALE_SHA }) })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      latestSha: LATEST_SHA,
      candidates: ['v8'],
    })

    expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: false })
  })

  it('falls back to the exact latest version without probing when the latest SHA is unknown', async () => {
    let client = createMockClient({ getTagSha: tagShas({ v8: STALE_SHA }) })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      candidates: ['v8'],
      latestSha: null,
    })

    expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: false })
    expect(client.getTagSha).not.toHaveBeenCalled()
  })

  it('reports rate limiting when tag validation hits the API limit', async () => {
    let client = createMockClient({
      getTagSha: tagShas({
        v8: new GitHubRateLimitError(new Date('2026-10-03T14:37:21.000Z')),
      }),
    })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      latestSha: LATEST_SHA,
      candidates: ['v8'],
    })

    expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: true })
  })

  it('does not report rate limiting when a candidate still matches', async () => {
    let client = createMockClient({
      getTagSha: tagShas({
        'v6.2': new GitHubRateLimitError(new Date('2026-10-03T14:37:21.000Z')),
        v6: LATEST_SHA,
      }),
    })

    let result = await selectExistingTagReference(client, {
      candidates: ['v6.2', 'v6'],
      actionName: 'owner/repo',
      latestVersion: 'v6.2.3',
      latestSha: LATEST_SHA,
    })

    expect(result).toStrictEqual({ rateLimited: false, reference: 'v6' })
  })

  it.each([
    { description: 'without an owner', actionName: '/repo' },
    { description: 'without a repository', actionName: 'owner' },
  ])(
    'returns the latest version without probing for an action name $description',
    async ({ actionName }) => {
      let client = createMockClient({ getTagSha: tagShas({ v8: LATEST_SHA }) })

      let result = await selectExistingTagReference(client, {
        latestVersion: 'v8.3.2',
        latestSha: LATEST_SHA,
        candidates: ['v8'],
        actionName,
      })

      expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: false })
      expect(client.getTagSha).not.toHaveBeenCalled()
    },
  )

  it('returns the latest version when there are no candidates', async () => {
    let client = createMockClient({ getTagSha: tagShas({ v8: LATEST_SHA }) })

    let result = await selectExistingTagReference(client, {
      actionName: 'owner/repo',
      latestVersion: 'v8.3.2',
      latestSha: LATEST_SHA,
      candidates: [],
    })

    expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: false })
  })

  describe('defensive branches unreachable through the public API', () => {
    it('falls back without the rate limit flag when a lookup fails with another error', async () => {
      let client = createMockClient({
        getTagSha: tagShas({ v8: new TypeError('fetch failed') }),
      })

      let result = await selectExistingTagReference(client, {
        actionName: 'owner/repo',
        latestVersion: 'v8.3.2',
        latestSha: LATEST_SHA,
        candidates: ['v8'],
      })

      expect(result).toStrictEqual({ reference: 'v8.3.2', rateLimited: false })
    })
  })
})
