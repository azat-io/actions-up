import { describe, expect, it, vi } from 'vitest'

import type { GitHubClient } from '../../types/github-client'

import { GitHubRateLimitError } from '../../core/api/internal-rate-limit-error'
import { resolveTagMeta } from '../../core/api/resolve-tag-meta'
import { createMockClient } from '../helpers/create-mock-client'

describe('resolveTagMeta', () => {
  it('returns the tag date and commit SHA', async () => {
    let date = new Date('2024-01-01T00:00:00Z')
    let getTagInfo = vi.fn<GitHubClient['getTagInfo']>().mockResolvedValue({
      sha: 'abc1234',
      message: null,
      tag: 'v1.0.0',
      date,
    })

    let meta = await resolveTagMeta(createMockClient({ getTagInfo }), {
      tag: 'v1.0.0',
      owner: 'o',
      repo: 'r',
    })

    expect(meta).toStrictEqual({ sha: 'abc1234', date })
    expect(getTagInfo).toHaveBeenCalledWith('o', 'r', 'v1.0.0')
  })

  it('returns nulls when the tag is not found', async () => {
    let client = createMockClient({
      getTagInfo: vi.fn().mockResolvedValue(null),
    })

    let meta = await resolveTagMeta(client, {
      tag: 'v1.0.0',
      owner: 'o',
      repo: 'r',
    })

    expect(meta).toStrictEqual({ date: null, sha: null })
  })

  it('returns nulls when the lookup fails', async () => {
    let client = createMockClient({
      getTagInfo: vi.fn().mockRejectedValue(new Error('boom')),
    })

    let meta = await resolveTagMeta(client, {
      tag: 'v1.0.0',
      owner: 'o',
      repo: 'r',
    })

    expect(meta).toStrictEqual({ date: null, sha: null })
  })

  it('rethrows rate limit errors', async () => {
    let error = new GitHubRateLimitError(new Date(0))
    let client = createMockClient({
      getTagInfo: vi.fn().mockRejectedValue(error),
    })

    await expect(
      resolveTagMeta(client, { tag: 'v1.0.0', owner: 'o', repo: 'r' }),
    ).rejects.toBe(error)
  })
})
