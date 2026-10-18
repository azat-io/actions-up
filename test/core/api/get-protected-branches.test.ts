import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeBranchPayload,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { getProtectedBranches } from '../../../core/api/get-protected-branches'
import { createClientContext } from '../../helpers/create-client-context'

const BRANCHES_PATH =
  '/repos/actions/checkout/branches?protected=true&per_page=100'

const PARAMETERS = { owner: 'actions', repo: 'checkout' }

describe('getProtectedBranches', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the protected branches with the commit at the tip of each', async () => {
    let api = routeFetch({
      [BRANCHES_PATH]: ok([
        makeBranchPayload('main', 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a'),
        makeBranchPayload(
          'releases/v4',
          '11d5960a32678a9e3b3ba0b5c1c6e7d9b1dfe4a0',
        ),
      ]),
    })

    let branches = await getProtectedBranches(createClientContext(), PARAMETERS)

    expect(branches).toStrictEqual([
      { sha: 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a', name: 'main' },
      { sha: '11d5960a32678a9e3b3ba0b5c1c6e7d9b1dfe4a0', name: 'releases/v4' },
    ])
    expect(api.paths).toStrictEqual([BRANCHES_PATH])
  })

  it.each([
    ['a missing repository', notFound(), 'GitHub API error: 404 Not Found'],
    [
      'a server error',
      serverError(),
      'GitHub API error: 500 Internal Server Error',
    ],
  ])(
    'reports %s instead of reading it as a repository without protected branches',
    async (_case, answer, message) => {
      routeFetch({ [BRANCHES_PATH]: answer })

      let lookup = getProtectedBranches(createClientContext(), PARAMETERS)

      await expect(lookup).rejects.toThrow(message)
    },
  )

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [BRANCHES_PATH]: rateLimited(resetAt) })

    let lookup = getProtectedBranches(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
