import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { resolveTagMeta } from '../../core/api/resolve-tag-meta'
import { createMockClient } from '../helpers/create-mock-client'

const COMMIT_SHA = '4c8af723bc21ec22ec103ee99e8e84914c937128'

describe('resolveTagMeta', () => {
  it('returns the tag date and commit SHA', async () => {
    let date = new Date('2024-10-23T14:46:00Z')
    let getTagInfo = vi.fn<GitHubClient['getTagInfo']>().mockResolvedValue({
      message: 'Release v4.2.2',
      sha: COMMIT_SHA,
      tag: 'v4.2.2',
      date,
    })

    let meta = await resolveTagMeta(createMockClient({ getTagInfo }), {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(meta).toStrictEqual({ sha: COMMIT_SHA, date })
    expect(getTagInfo).toHaveBeenCalledExactlyOnceWith(
      'actions',
      'checkout',
      'v4.2.2',
    )
  })

  it('returns nulls when the tag is not found', async () => {
    let client = createMockClient({
      getTagInfo: vi.fn().mockResolvedValue(null),
    })

    let meta = await resolveTagMeta(client, {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(meta).toStrictEqual({ date: null, sha: null })
  })

  it('returns nulls when the lookup fails', async () => {
    let client = createMockClient({
      getTagInfo: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    })

    let meta = await resolveTagMeta(client, {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    expect(meta).toStrictEqual({ date: null, sha: null })
  })

  it('rethrows rate limit errors', async () => {
    let error = new GitHubRateLimitError(new Date('2026-10-03T14:37:21.000Z'))
    let client = createMockClient({
      getTagInfo: vi.fn().mockRejectedValue(error),
    })

    let lookup = resolveTagMeta(client, {
      owner: 'actions',
      repo: 'checkout',
      tag: 'v4.2.2',
    })

    await expect(lookup).rejects.toBe(error)
  })
})
