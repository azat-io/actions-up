import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  branchUpdatesPage,
  makeBranchUpdate,
  serverError,
  rateLimited,
  routeFetch,
} from '../../helpers/route-fetch'
import { GitHubRateLimitError } from '../../../core/api/internal-rate-limit-error'
import { createClientContext } from '../../helpers/create-client-context'
import { getBranchTipAt } from '../../../core/api/get-branch-tip-at'

const FIRST_PAGE_PATH = `/repos/actions/checkout/activity?ref=${encodeURIComponent('refs/heads/main')}&direction=desc&per_page=100`

/**
 * Path of a later page of the history.
 *
 * @param cursor - Value GitHub puts in the `after` parameter of the link to the
 *   page.
 * @returns API path of the page.
 */
function laterPagePath(cursor: string): string {
  return `/repositories/197814629/activity?direction=desc&per_page=100&after=${cursor}`
}

const AT = new Date('2026-10-02T12:00:00.000Z')

const NO_COMMIT = '0'.repeat(40)

const OLDER_TIP = 'a'.repeat(40)

const TIP_AT_MOMENT = 'b'.repeat(40)

const LATER_TIP = 'c'.repeat(40)

const PARAMETERS = {
  owner: 'actions',
  repo: 'checkout',
  branch: 'main',
  at: AT,
}

describe('getBranchTipAt', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('answers with the tip the last update before the moment left', async () => {
    let api = routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage([
        makeBranchUpdate({
          timestamp: '2026-10-03T09:00:00Z',
          before: TIP_AT_MOMENT,
          after: LATER_TIP,
        }),
        makeBranchUpdate({
          timestamp: '2026-10-01T09:00:00Z',
          after: TIP_AT_MOMENT,
          before: OLDER_TIP,
        }),
      ]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toStrictEqual({
      since: new Date('2026-10-01T09:00:00.000Z'),
      sha: TIP_AT_MOMENT,
    })
    expect(api.paths).toStrictEqual([FIRST_PAGE_PATH])
  })

  it('counts an update made at the moment itself', async () => {
    routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage([
        makeBranchUpdate({
          timestamp: AT.toISOString(),
          after: TIP_AT_MOMENT,
          before: OLDER_TIP,
        }),
      ]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toMatchObject({ sha: TIP_AT_MOMENT })
  })

  it('reads on to the next page until it reaches the moment', async () => {
    let api = routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage(
        [
          makeBranchUpdate({
            timestamp: '2026-10-03T09:00:00Z',
            before: TIP_AT_MOMENT,
            after: LATER_TIP,
          }),
        ],
        'c1',
      ),
      [laterPagePath('c1')]: branchUpdatesPage([
        makeBranchUpdate({
          timestamp: '2026-09-20T09:00:00Z',
          after: TIP_AT_MOMENT,
          before: OLDER_TIP,
        }),
      ]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toMatchObject({ sha: TIP_AT_MOMENT })
    expect(api.paths).toStrictEqual([FIRST_PAGE_PATH, laterPagePath('c1')])
  })

  it('takes the commit the earliest recorded update moved away from when every update came later', async () => {
    routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage(
        [
          makeBranchUpdate({
            timestamp: '2026-10-03T09:00:00Z',
            before: TIP_AT_MOMENT,
            after: LATER_TIP,
          }),
        ],
        'c1',
      ),
      [laterPagePath('c1')]: branchUpdatesPage([]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toStrictEqual({ sha: TIP_AT_MOMENT, since: null })
  })

  it.each([
    [
      'was created after the moment',
      makeBranchUpdate({
        timestamp: '2026-10-03T09:00:00Z',
        activityType: 'branch_creation',
        before: NO_COMMIT,
        after: LATER_TIP,
      }),
    ],
    [
      'was deleted before the moment',
      makeBranchUpdate({
        timestamp: '2026-10-01T09:00:00Z',
        activityType: 'branch_deletion',
        before: TIP_AT_MOMENT,
        after: NO_COMMIT,
      }),
    ],
  ])('answers with no tip for a branch that %s', async (_case, update) => {
    routeFetch({ [FIRST_PAGE_PATH]: branchUpdatesPage([update]) })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toMatchObject({ sha: null })
  })

  it.each(['pr_merge', 'merge_queue_merge'])(
    'reads past a later %s, which only moves the branch forward',
    async activityType => {
      routeFetch({
        [FIRST_PAGE_PATH]: branchUpdatesPage([
          makeBranchUpdate({
            timestamp: '2026-10-03T09:00:00Z',
            before: TIP_AT_MOMENT,
            after: LATER_TIP,
            activityType,
          }),
          makeBranchUpdate({
            timestamp: '2026-10-01T09:00:00Z',
            after: TIP_AT_MOMENT,
            before: OLDER_TIP,
          }),
        ]),
      })

      let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

      expect(tip).toMatchObject({ sha: TIP_AT_MOMENT })
    },
  )

  it.each([
    ['a force push', 'force_push'],
    ['a deletion', 'branch_deletion'],
    ['an update of an unknown kind', 'ref_rewrite'],
  ])(
    'leaves the tip undetermined after %s, which may have dropped what the branch held',
    async (_case, activityType) => {
      routeFetch({
        [FIRST_PAGE_PATH]: branchUpdatesPage([
          makeBranchUpdate({
            timestamp: '2026-10-03T09:00:00Z',
            before: TIP_AT_MOMENT,
            after: LATER_TIP,
            activityType,
          }),
          makeBranchUpdate({
            timestamp: '2026-10-01T09:00:00Z',
            after: TIP_AT_MOMENT,
            before: OLDER_TIP,
          }),
        ]),
      })

      let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

      expect(tip).toBeNull()
    },
  )

  it('answers with no tip for a branch created again after the moment, whatever it held before', async () => {
    routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage([
        makeBranchUpdate({
          timestamp: '2026-10-03T10:00:00Z',
          activityType: 'branch_creation',
          before: NO_COMMIT,
          after: LATER_TIP,
        }),
        makeBranchUpdate({
          timestamp: '2026-10-03T09:00:00Z',
          activityType: 'branch_deletion',
          before: TIP_AT_MOMENT,
          after: NO_COMMIT,
        }),
        makeBranchUpdate({
          timestamp: '2026-10-01T09:00:00Z',
          after: TIP_AT_MOMENT,
          before: OLDER_TIP,
        }),
      ]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toStrictEqual({ since: null, sha: null })
  })

  it('leaves the tip undetermined when a page lists an update of another branch', async () => {
    routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage([
        makeBranchUpdate({
          timestamp: '2026-10-01T09:00:00Z',
          reference: 'refs/heads/feature',
          after: TIP_AT_MOMENT,
          before: OLDER_TIP,
        }),
      ]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toBeNull()
  })

  it.each([
    ['before the recorded history', new Date('2023-06-01T00:00:00.000Z')],
    ['that is not a valid date', new Date(Number.NaN)],
  ])(
    'leaves the tip at a moment %s undetermined, without a request',
    async (_case, at) => {
      let api = routeFetch({})

      let tip = await getBranchTipAt(createClientContext(), {
        ...PARAMETERS,
        at,
      })

      expect(tip).toBeNull()
      expect(api.paths).toStrictEqual([])
    },
  )

  it('leaves the tip of a branch without a recorded update undetermined, since the history names no commit', async () => {
    routeFetch({ [FIRST_PAGE_PATH]: branchUpdatesPage([]) })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toBeNull()
  })

  it('gives up after three pages without reaching the moment', async () => {
    let later = makeBranchUpdate({
      timestamp: '2026-10-03T09:00:00Z',
      before: TIP_AT_MOMENT,
      after: LATER_TIP,
    })
    let api = routeFetch({
      [laterPagePath('c1')]: branchUpdatesPage([later], 'c2'),
      [laterPagePath('c2')]: branchUpdatesPage([later], 'c3'),
      [FIRST_PAGE_PATH]: branchUpdatesPage([later], 'c1'),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toBeNull()
    expect(api.paths).toHaveLength(3)
  })

  it('answers null when a recorded moment cannot be read', async () => {
    routeFetch({
      [FIRST_PAGE_PATH]: branchUpdatesPage([
        makeBranchUpdate({
          after: TIP_AT_MOMENT,
          timestamp: 'never',
          before: OLDER_TIP,
        }),
      ]),
    })

    let tip = await getBranchTipAt(createClientContext(), PARAMETERS)

    expect(tip).toBeNull()
  })

  it('reports a failed request', async () => {
    routeFetch({ [FIRST_PAGE_PATH]: serverError() })

    let lookup = getBranchTipAt(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toHaveProperty('status', 500)
  })

  it('throws GitHubRateLimitError with the reset time from the response', async () => {
    let resetAt = new Date('2026-10-03T14:37:21.000Z')
    routeFetch({ [FIRST_PAGE_PATH]: rateLimited(resetAt) })

    let lookup = getBranchTipAt(createClientContext(), PARAMETERS)

    await expect(lookup).rejects.toStrictEqual(
      new GitHubRateLimitError(resetAt),
    )
  })
})
