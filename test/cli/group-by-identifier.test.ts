import { describe, expect, it } from 'vitest'

import { groupByIdentifier } from '../../cli/group-by-identifier'

/**
 * Reference of an update as the CLI pipeline reports it.
 */
interface UpdateOptions {
  /**
   * Version the reference is pinned to.
   */
  version?: string

  /**
   * Action name.
   */
  name?: string
}

/**
 * Entry in the shape the warning printers hand to the grouper.
 */
type GroupedUpdate = Parameters<typeof groupByIdentifier>[0][number]

/**
 * Create an update for an action reference, with the current version taken from
 * the reference as the update check does.
 *
 * @param options - Reference; `actions/checkout@v4` by default.
 * @returns Fresh update.
 */
function makeUpdate({
  name = 'actions/checkout',
  version = 'v4',
}: UpdateOptions = {}): GroupedUpdate {
  return { action: { version, name }, currentVersion: version }
}

describe('groupByIdentifier', () => {
  it('returns no groups for no updates', () => {
    expect(groupByIdentifier([])).toStrictEqual([])
  })

  it('counts every update that shares an identifier', () => {
    let updates = [makeUpdate(), makeUpdate()]

    let result = groupByIdentifier(updates)

    expect(result).toStrictEqual([
      { identifier: 'actions/checkout@v4', count: 2 },
    ])
  })

  it('preserves order of first appearance', () => {
    let updates = [
      makeUpdate({ name: 'actions/setup-node' }),
      makeUpdate(),
      makeUpdate({ name: 'actions/setup-node' }),
    ]

    let result = groupByIdentifier(updates)

    expect(result).toStrictEqual([
      { identifier: 'actions/setup-node@v4', count: 2 },
      { identifier: 'actions/checkout@v4', count: 1 },
    ])
  })

  it('identifies an update by its uses reference verbatim when present', () => {
    let updates = [
      {
        action: { uses: 'actions/checkout@v4', name: 'actions/checkout' },
        currentVersion: 'v4.2.2',
      },
    ]

    let result = groupByIdentifier(updates)

    expect(result).toStrictEqual([
      { identifier: 'actions/checkout@v4', count: 1 },
    ])
  })

  /**
   * `action.version` is left out so that the version in the identifier can only
   * come from `currentVersion`.
   */
  it.each([
    {
      update: { action: { name: 'actions/setup-node' }, currentVersion: 'v4' },
      description: 'the name and the current version',
      expectedIdentifier: 'actions/setup-node@v4',
    },
    {
      update: { action: { name: 'actions/cache' }, currentVersion: null },
      description: 'the name and an unknown version',
      expectedIdentifier: 'actions/cache@unknown',
    },
  ])(
    'falls back to $description without a uses reference',
    ({ expectedIdentifier, update }) => {
      let result = groupByIdentifier([update])

      expect(result).toStrictEqual([
        { identifier: expectedIdentifier, count: 1 },
      ])
    },
  )
})
