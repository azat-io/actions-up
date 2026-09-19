/* eslint-disable camelcase */

import { describe, expect, it } from 'vitest'

import { normalizeRelease } from '../../core/api/normalize-release'

describe('normalizeRelease', () => {
  it('maps release payload fields to release information', () => {
    let release = normalizeRelease(
      {
        published_at: '2024-03-01T00:00:00Z',
        target_commitish: 'main',
        tag_name: 'v3.0.0',
        prerelease: true,
        html_url: 'u',
        body: 'Desc',
        name: 'Rel',
      },
      'abc1234',
    )

    expect(release).toStrictEqual({
      publishedAt: new Date('2024-03-01T00:00:00Z'),
      description: 'Desc',
      isPrerelease: true,
      version: 'v3.0.0',
      sha: 'abc1234',
      name: 'Rel',
      url: 'u',
    })
  })

  it('falls back name to tag_name and description to null', () => {
    let release = normalizeRelease(
      {
        published_at: '2024-03-01T00:00:00Z',
        target_commitish: null,
        tag_name: 'v3.0.0',
        prerelease: false,
        html_url: 'u',
        body: null,
        name: null,
      },
      null,
    )

    expect(release).toMatchObject({
      description: null,
      name: 'v3.0.0',
      sha: null,
    })
  })
})

/* eslint-enable camelcase */
