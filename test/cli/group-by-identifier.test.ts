import { describe, expect, it } from 'vitest'

import { groupByIdentifier } from '../../cli/group-by-identifier'

describe('groupByIdentifier', () => {
  it('returns empty array for empty input', () => {
    expect(groupByIdentifier([])).toEqual([])
  })

  it('counts duplicate identifiers', () => {
    let updates = [
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
    ]

    expect(groupByIdentifier(updates)).toEqual([
      { identifier: 'actions/checkout@v3', count: 2 },
    ])
  })

  it('preserves order of first appearance', () => {
    let updates = [
      {
        action: { name: 'actions/setup-node', version: 'v3' },
        currentVersion: 'v3',
      },
      {
        action: { name: 'actions/checkout', version: 'v3' },
        currentVersion: 'v3',
      },
      {
        action: { name: 'actions/setup-node', version: 'v3' },
        currentVersion: 'v3',
      },
    ]

    expect(groupByIdentifier(updates)).toEqual([
      { identifier: 'actions/setup-node@v3', count: 2 },
      { identifier: 'actions/checkout@v3', count: 1 },
    ])
  })

  it('uses action.uses when available as identifier', () => {
    let updates = [
      {
        action: {
          uses: 'actions/checkout@v3',
          name: 'actions/checkout',
          version: 'v3',
        },
        currentVersion: 'v3',
      },
    ]

    expect(groupByIdentifier(updates)).toEqual([
      { identifier: 'actions/checkout@v3', count: 1 },
    ])
  })

  it('falls back to name@unknown when uses and currentVersion are not set', () => {
    let updates = [
      {
        action: { name: 'actions/checkout' },
        currentVersion: null,
      },
    ]

    expect(groupByIdentifier(updates)).toEqual([
      { identifier: 'actions/checkout@unknown', count: 1 },
    ])
  })
})
