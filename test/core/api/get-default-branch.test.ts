import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeRepositoryPayload,
  serverError,
  rateLimited,
  routeFetch,
  notFound,
  ok,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'
import { getDefaultBranch } from '../../../core/api/get-default-branch'

const REPOSITORY_PATH = '/repos/actions/checkout'

const PARAMETERS = { owner: 'actions', repo: 'checkout' }

describe('getDefaultBranch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the name of the default branch', async () => {
    let api = routeFetch({
      [REPOSITORY_PATH]: ok(makeRepositoryPayload('trunk')),
    })

    let branch = await getDefaultBranch(createClientContext(), PARAMETERS)

    expect(branch).toBe('trunk')
    expect(api.paths).toStrictEqual([REPOSITORY_PATH])
  })

  it('asks once per repository for the rest of the run', async () => {
    let api = routeFetch({
      [REPOSITORY_PATH]: ok(makeRepositoryPayload('main')),
    })
    let context = createClientContext()

    await getDefaultBranch(context, PARAMETERS)
    await getDefaultBranch(context, PARAMETERS)

    expect(api.paths).toStrictEqual([REPOSITORY_PATH])
  })

  it.each([
    ['a missing repository', notFound(), 404],
    ['a server error', serverError(), 500],
  ])('reports %s', async (_case, answer, status) => {
    routeFetch({ [REPOSITORY_PATH]: answer })

    let lookup = getDefaultBranch(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toHaveProperty('status', status)
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [REPOSITORY_PATH]: rateLimited(resetAt) })

    let lookup = getDefaultBranch(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
