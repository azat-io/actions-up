/* eslint-disable camelcase */

import { describe, expect, it } from 'vitest'

import type { GitHubReleasePayload } from '../../../core/api/normalize-release'

import { normalizeRelease } from '../../../core/api/normalize-release'

const COMMIT_SHA = '96a4a52b98069a174b6076e813e95e0dc6b3635a'

/**
 * Release payload with realistic defaults.
 *
 * @param overrides - Fields to replace.
 * @returns Fresh release payload.
 */
function makePayload(
  overrides: Partial<GitHubReleasePayload> = {},
): GitHubReleasePayload {
  return {
    html_url: 'https://github.com/actions/checkout/releases/tag/v5.0.0-beta.1',
    body: '## Breaking changes\n* Node 24 runtime',
    published_at: '2025-08-11T09:30:00Z',
    target_commitish: COMMIT_SHA,
    tag_name: 'v5.0.0-beta.1',
    prerelease: true,
    name: 'v5 beta',
    ...overrides,
  }
}

describe('normalizeRelease', () => {
  it('maps release payload fields to release information', () => {
    let release = normalizeRelease(makePayload(), COMMIT_SHA)

    expect(release).toStrictEqual({
      url: 'https://github.com/actions/checkout/releases/tag/v5.0.0-beta.1',
      description: '## Breaking changes\n* Node 24 runtime',
      publishedAt: new Date('2025-08-11T09:30:00Z'),
      version: 'v5.0.0-beta.1',
      isPrerelease: true,
      name: 'v5 beta',
      sha: COMMIT_SHA,
    })
  })

  it('names an untitled release after its tag', () => {
    let release = normalizeRelease(
      makePayload({ tag_name: 'v4.3.0', prerelease: false, name: null }),
      null,
    )

    expect(release).toStrictEqual({
      url: 'https://github.com/actions/checkout/releases/tag/v5.0.0-beta.1',
      description: '## Breaking changes\n* Node 24 runtime',
      publishedAt: new Date('2025-08-11T09:30:00Z'),
      isPrerelease: false,
      version: 'v4.3.0',
      name: 'v4.3.0',
      sha: null,
    })
  })

  it('gives a release without notes no description', () => {
    let release = normalizeRelease(makePayload({ body: null }), COMMIT_SHA)

    expect(release.description).toBeNull()
  })
})

/* eslint-enable camelcase */
