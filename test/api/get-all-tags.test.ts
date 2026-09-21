import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClientContext } from '../helpers/create-client-context'
import { getAllTags } from '../../core/api/get-all-tags'

describe('getAllTags', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('maps tags to TagInfo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { commit: { sha: 'a', url: 'x' }, name: 'v1' },
          { commit: { sha: 'b', url: 'y' }, name: 'v2' },
        ]),
        { status: 200 },
      ),
    )

    let tags = await getAllTags(createClientContext(), {
      owner: 'o',
      repo: 'r',
      limit: 2,
    })
    expect(tags).toEqual([
      { message: null, date: null, tag: 'v1', sha: 'a' },
      { message: null, date: null, tag: 'v2', sha: 'b' },
    ])
  })
})
