import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeComparisonPayload,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'
import { compareCommits } from '../../../core/api/compare-commits'

const HEAD_SHA = '34e114876b0b11c390a56381ad16ebd13914f8d5'

const BASE_SHA = 'f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a'

const DEFAULT_BRANCH_PATH = `/repos/actions/checkout/compare/${encodeURIComponent('refs/heads/main')}...${HEAD_SHA}`

const PARAMETERS = {
  base: 'refs/heads/main',
  owner: 'actions',
  repo: 'checkout',
  head: HEAD_SHA,
}

describe('compareCommits', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['behind', 'identical', 'ahead', 'diverged'] as const)(
    'reports a commit %s the base',
    async status => {
      routeFetch({
        [DEFAULT_BRANCH_PATH]: ok(makeComparisonPayload(status)),
      })

      let comparison = await compareCommits(createClientContext(), PARAMETERS)

      expect(comparison).toBe(status)
    },
  )

  it('compares with a commit as the base', async () => {
    let path = `/repos/actions/checkout/compare/${BASE_SHA}...${HEAD_SHA}`
    let api = routeFetch({
      [path]: ok(makeComparisonPayload('behind')),
    })

    await compareCommits(createClientContext(), {
      ...PARAMETERS,
      base: BASE_SHA,
    })

    expect(api.paths).toStrictEqual([path])
  })

  it('answers null when GitHub finds no shared history', async () => {
    routeFetch({ [DEFAULT_BRANCH_PATH]: notFound() })

    let comparison = await compareCommits(createClientContext(), PARAMETERS)

    expect(comparison).toBeNull()
  })

  it('reports any other failure', async () => {
    routeFetch({ [DEFAULT_BRANCH_PATH]: serverError() })

    let lookup = compareCommits(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toThrow(
      'GitHub API error: 500 Internal Server Error',
    )
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [DEFAULT_BRANCH_PATH]: rateLimited(resetAt) })

    let lookup = compareCommits(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
